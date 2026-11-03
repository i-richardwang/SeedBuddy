import { deflateRawSync } from "node:zlib";

import { expect, test } from "bun:test";

import { ArchiveFormatError, crc32, readStoredZip, storedZip } from "./zip";

async function collect(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function entriesOf(bytes: Uint8Array) {
  const entries = [];
  for await (const entry of readStoredZip(
    new Blob([Buffer.from(bytes)]).stream(),
    { maxEntries: 10, maxEntryBytes: 100_000 },
  )) {
    entries.push({
      name: entry.name,
      text: Buffer.from(entry.bytes).toString(),
    });
  }
  return entries;
}

test("crc32 matches the reference value", () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
});

test("entries round-trip in order and system tools can list them", async () => {
  const entries = [
    { name: "datasets/seeds.json", bytes: new TextEncoder().encode("{}") },
    { name: "blobs/ab/abc", bytes: new Uint8Array(70_000).fill(7) },
    { name: "empty", bytes: new Uint8Array(0) },
  ];
  const first = await collect(storedZip(entries));
  const again = await collect(
    storedZip(
      (async function* () {
        yield* entries;
      })(),
    ),
  );
  expect(again).toEqual(first);
  expect(await entriesOf(first)).toEqual([
    { name: "datasets/seeds.json", text: "{}" },
    { name: "blobs/ab/abc", text: Buffer.alloc(70_000, 7).toString() },
    { name: "empty", text: "" },
  ]);
  expect(first.subarray(-22).readUInt32LE(0)).toBe(0x06054b50);
  expect(first.subarray(-22).readUInt16LE(10)).toBe(3);

  const listing = Bun.spawnSync(["unzip", "-l", "-"], { stdin: first });
  if (listing.exitCode === 0) {
    const text = listing.stdout.toString();
    expect(text).toContain("datasets/seeds.json");
    expect(text).toContain("blobs/ab/abc");
  }
});

test("an archive without entries reads as none", async () => {
  expect(await entriesOf(await collect(storedZip([])))).toEqual([]);
});

test("archives the workbench did not write are refused", async () => {
  await expect(entriesOf(new Uint8Array(0))).rejects.toThrow(
    ArchiveFormatError,
  );
  await expect(
    entriesOf(new TextEncoder().encode("not a zip")),
  ).rejects.toThrow(/not a ZIP/);
  const stored = await collect(
    storedZip([{ name: "a", bytes: new TextEncoder().encode("hello") }]),
  );
  const truncated = stored.subarray(0, 30 + 1 + 2);
  await expect(entriesOf(truncated)).rejects.toThrow(/ends before/);

  const deflated = Buffer.from(stored);
  deflated.writeUInt16LE(8, 8);
  const payload = deflateRawSync("hello");
  const rewritten = Buffer.concat([
    deflated.subarray(0, 18),
    Buffer.from(new Uint32Array([payload.byteLength]).buffer),
    deflated.subarray(22, 31),
    payload,
  ]);
  await expect(entriesOf(rewritten)).rejects.toThrow(/rewritten/);

  const corrupted = Buffer.from(stored);
  corrupted[31] = corrupted[31]! ^ 1;
  await expect(entriesOf(corrupted)).rejects.toThrow(/CRC/);

  const oversized = Buffer.from(stored);
  oversized.writeUInt32LE(100_001, 18);
  oversized.writeUInt32LE(100_001, 22);
  await expect(entriesOf(oversized)).rejects.toThrow(/too large/);
});
