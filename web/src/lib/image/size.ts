/** Width and height in pixels. */
export interface PixelSize {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The size a PNG's header declares: IHDR is always its first chunk. */
function pngSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 24) return null;
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * The size a JPEG's frame header declares. Segments are walked from the
 * start, so an embedded thumbnail, which sits inside an application
 * segment, is never taken for the photograph.
 */
function jpegSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // Fill bytes before a marker, and markers that stand alone.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    const frame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (frame) {
      if (offset + 9 > bytes.length) return null;
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    // The image data follows a scan header; no frame header comes after it.
    if (marker === 0xda || length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/**
 * The pixel size a JPEG or PNG declares, read from the start of the file
 * without decoding it, as stored: a camera's orientation is not applied.
 * Null when the bytes are neither, or do not reach the declaration.
 */
export function encodedImageSize(bytes: Uint8Array): PixelSize | null {
  return pngSize(bytes) ?? jpegSize(bytes);
}
