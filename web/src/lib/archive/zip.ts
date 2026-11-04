/**
 * ZIP archives that store their entries as they are. The workbench hands
 * people canonical images, which no general-purpose compressor shrinks, so
 * an archive is a container and nothing more: every entry's size is written
 * in its local header, and a reader takes each entry from the stream by
 * length without searching the bytes for markers. That keeps a browser able
 * to read an archive far larger than its memory, one entry at a time.
 *
 * The writer produces the same bytes for the same entries: timestamps are
 * fixed, and ZIP64 records appear only when the archive needs them.
 */

export interface ArchiveEntry {
  name: string;
  bytes: Uint8Array;
}

interface ReadArchiveEntry {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EXTRA = 0x0001;

const STORED = 0;
const UTF8_NAMES = 0x0800;
const VERSION_STORED = 20;
const VERSION_ZIP64 = 45;
/** 1980-01-01 00:00, the earliest moment DOS timestamps represent. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
const LIMIT_32 = 0xffffffff;
const LIMIT_16 = 0xffff;

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

class Writer {
  private readonly view: DataView;
  private offset = 0;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u16(value: number) {
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  u32(value: number) {
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  u64(value: number) {
    this.view.setBigUint64(this.offset, BigInt(value), true);
    this.offset += 8;
  }

  put(bytes: Uint8Array) {
    this.bytes.set(bytes, this.offset);
    this.offset += bytes.byteLength;
  }
}

interface WrittenEntry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

function localHeader(name: Uint8Array, crc: number, size: number): Uint8Array {
  const out = new Writer(new Uint8Array(30 + name.byteLength));
  out.u32(LOCAL_HEADER);
  out.u16(VERSION_STORED);
  out.u16(UTF8_NAMES);
  out.u16(STORED);
  out.u16(DOS_TIME);
  out.u16(DOS_DATE);
  out.u32(crc);
  out.u32(size);
  out.u32(size);
  out.u16(name.byteLength);
  out.u16(0);
  out.put(name);
  return out.bytes;
}

function centralHeader(entry: WrittenEntry): Uint8Array {
  const zip64 = entry.offset >= LIMIT_32;
  const extraLength = zip64 ? 12 : 0;
  const out = new Writer(
    new Uint8Array(46 + entry.name.byteLength + extraLength),
  );
  out.u32(CENTRAL_HEADER);
  out.u16(zip64 ? VERSION_ZIP64 : VERSION_STORED);
  out.u16(zip64 ? VERSION_ZIP64 : VERSION_STORED);
  out.u16(UTF8_NAMES);
  out.u16(STORED);
  out.u16(DOS_TIME);
  out.u16(DOS_DATE);
  out.u32(entry.crc);
  out.u32(entry.size);
  out.u32(entry.size);
  out.u16(entry.name.byteLength);
  out.u16(extraLength);
  out.u16(0);
  out.u16(0);
  out.u16(0);
  out.u32(0);
  out.u32(zip64 ? LIMIT_32 : entry.offset);
  out.put(entry.name);
  if (zip64) {
    out.u16(ZIP64_EXTRA);
    out.u16(8);
    out.u64(entry.offset);
  }
  return out.bytes;
}

function endRecords(
  count: number,
  directoryOffset: number,
  directorySize: number,
): Uint8Array {
  const zip64 =
    count >= LIMIT_16 ||
    directoryOffset >= LIMIT_32 ||
    directorySize >= LIMIT_32;
  const out = new Writer(new Uint8Array(22 + (zip64 ? 56 + 20 : 0)));
  if (zip64) {
    out.u32(ZIP64_END_OF_CENTRAL_DIRECTORY);
    out.u64(44);
    out.u16(VERSION_ZIP64);
    out.u16(VERSION_ZIP64);
    out.u32(0);
    out.u32(0);
    out.u64(count);
    out.u64(count);
    out.u64(directorySize);
    out.u64(directoryOffset);
    out.u32(ZIP64_LOCATOR);
    out.u32(0);
    out.u64(directoryOffset + directorySize);
    out.u32(1);
  }
  out.u32(END_OF_CENTRAL_DIRECTORY);
  out.u16(0);
  out.u16(0);
  out.u16(Math.min(count, LIMIT_16));
  out.u16(Math.min(count, LIMIT_16));
  out.u32(Math.min(directorySize, LIMIT_32));
  out.u32(Math.min(directoryOffset, LIMIT_32));
  out.u16(0);
  return out.bytes;
}

/** A stored ZIP archive of the entries, emitted as they are produced. */
export function storedZip(
  entries: AsyncIterable<ArchiveEntry> | Iterable<ArchiveEntry>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const written: WrittenEntry[] = [];
  let offset = 0;
  const iterator =
    Symbol.asyncIterator in entries
      ? entries[Symbol.asyncIterator]()
      : entries[Symbol.iterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (!next.done) {
        const entry = next.value;
        const name = encoder.encode(entry.name);
        const crc = crc32(entry.bytes);
        const header = localHeader(name, crc, entry.bytes.byteLength);
        written.push({ name, crc, size: entry.bytes.byteLength, offset });
        controller.enqueue(header);
        controller.enqueue(entry.bytes);
        offset += header.byteLength + entry.bytes.byteLength;
        return;
      }
      let directorySize = 0;
      for (const entry of written) {
        const header = centralHeader(entry);
        controller.enqueue(header);
        directorySize += header.byteLength;
      }
      controller.enqueue(endRecords(written.length, offset, directorySize));
      controller.close();
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

/** Why a stream is not an archive `storedZip` wrote. */
export class ArchiveFormatError extends Error {}

interface StoredZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
}

/** Exact-length reads over a byte stream. */
class ByteReader {
  private pending: Uint8Array[] = [];
  private available = 0;
  private done = false;

  constructor(
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
  ) {}

  /** The next `length` bytes, or null at a clean end of the stream. */
  async read(length: number): Promise<Uint8Array<ArrayBuffer> | null> {
    while (this.available < length && !this.done) {
      const { done, value } = await this.reader.read();
      if (done) this.done = true;
      else if (value.byteLength > 0) {
        this.pending.push(value);
        this.available += value.byteLength;
      }
    }
    if (this.available === 0 && length > 0) return null;
    if (this.available < length) {
      throw new ArchiveFormatError("The archive ends before its entries do");
    }
    const out = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const chunk = this.pending[0]!;
      const take = Math.min(chunk.byteLength, length - filled);
      out.set(chunk.subarray(0, take), filled);
      filled += take;
      if (take === chunk.byteLength) this.pending.shift();
      else this.pending[0] = chunk.subarray(take);
    }
    this.available -= length;
    return out;
  }
}

/**
 * The entries of a stored archive, in order, each held whole. Archives that
 * compress entries or write their sizes after the data are refused, since
 * their entries cannot be taken from the stream by length.
 */
export async function* readStoredZip(
  stream: ReadableStream<Uint8Array>,
  limits: StoredZipLimits,
): AsyncGenerator<ReadArchiveEntry> {
  const reader = new ByteReader(stream.getReader());
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let entries = 0;
  for (;;) {
    const signatureBytes = await reader.read(4);
    if (!signatureBytes) throw new ArchiveFormatError("The file is empty");
    const signature = new DataView(
      signatureBytes.buffer,
      signatureBytes.byteOffset,
      4,
    ).getUint32(0, true);
    if (
      signature === CENTRAL_HEADER ||
      signature === END_OF_CENTRAL_DIRECTORY
    ) {
      return;
    }
    if (signature !== LOCAL_HEADER) {
      throw new ArchiveFormatError("The file is not a ZIP archive");
    }
    const header = await reader.read(26);
    if (!header) throw new ArchiveFormatError("The archive ends in a header");
    const view = new DataView(header.buffer, header.byteOffset, 26);
    const version = view.getUint16(0, true);
    const flags = view.getUint16(2, true);
    const method = view.getUint16(4, true);
    const expectedCrc = view.getUint32(10, true);
    const compressedSize = view.getUint32(14, true);
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(22, true);
    const extraLength = view.getUint16(24, true);
    if (
      version !== VERSION_STORED ||
      method !== STORED ||
      flags !== UTF8_NAMES ||
      size === LIMIT_32 ||
      compressedSize !== size
    ) {
      throw new ArchiveFormatError(
        "The archive was rewritten; use the one the workbench produced",
      );
    }
    entries += 1;
    if (entries > limits.maxEntries) {
      throw new ArchiveFormatError("The archive contains too many entries");
    }
    if (size > limits.maxEntryBytes) {
      throw new ArchiveFormatError("An archive entry is too large");
    }
    const name = await reader.read(nameLength);
    await reader.read(extraLength);
    const bytes = await reader.read(size);
    if (!name || bytes === null) {
      throw new ArchiveFormatError("The archive ends before its entries do");
    }
    if (crc32(bytes) !== expectedCrc) {
      throw new ArchiveFormatError("An archive entry failed its CRC check");
    }
    yield { name: decoder.decode(name), bytes };
  }
}
