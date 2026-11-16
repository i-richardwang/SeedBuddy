import { expect, test } from "bun:test";
import sharp from "sharp";

import { canonicalize } from "./ingest";

const WIDTH = 12;
const HEIGHT = 8;
const PIXELS = Buffer.alloc(WIDTH * HEIGHT * 3, 96);

function source() {
  return sharp(PIXELS, {
    raw: { width: WIDTH, height: HEIGHT, channels: 3 },
  });
}

test("canonical images are opaque, oriented sRGB AVIF images", async () => {
  const transparent = await sharp(Buffer.from([255, 0, 0, 0]), {
    raw: { width: 1, height: 1, channels: 4 },
  })
    .png()
    .toBuffer();
  const canonical = await canonicalize(transparent);
  const metadata = await sharp(canonical.bytes).metadata();
  const pixel = await sharp(canonical.bytes).raw().toBuffer();

  expect(metadata).toMatchObject({
    format: "heif",
    width: 1,
    height: 1,
    space: "srgb",
    channels: 3,
    hasAlpha: false,
  });
  expect(new Set(pixel).size).toBe(1);
  expect(pixel[0]).toBeGreaterThanOrEqual(250);

  const oriented = await source()
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  expect(await canonicalize(oriented)).toMatchObject({
    width: HEIGHT,
    height: WIDTH,
  });
});

test("canonical ingestion accepts exactly one JPEG, PNG, or TIFF image", async () => {
  for (const encoded of [
    await source().jpeg().toBuffer(),
    await source().png().toBuffer(),
    await source().tiff().toBuffer(),
  ]) {
    const first = await canonicalize(encoded);
    const again = await canonicalize(encoded);
    expect(first.digest).toBe(again.digest);
    expect(first.bytes).toEqual(again.bytes);
  }

  const svg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"/>',
  );
  await expect(canonicalize(svg)).rejects.toThrow(/JPEG, PNG, or TIFF/);

  const pages = await sharp(Buffer.alloc(WIDTH * HEIGHT * 2 * 3), {
    raw: {
      width: WIDTH,
      height: HEIGHT * 2,
      channels: 3,
      pageHeight: HEIGHT,
    },
  })
    .tiff()
    .toBuffer();
  await expect(canonicalize(pages)).rejects.toThrow(/exactly one image/);
});

test("canonical ingestion refuses more pixels than it decodes", async () => {
  const oversized = await sharp({
    create: { width: 8000, height: 5001, channels: 3, background: "#606060" },
  })
    .png({ compressionLevel: 1 })
    .toBuffer();
  await expect(canonicalize(oversized)).rejects.toThrow(
    /more than 40 megapixels cannot be stored: 8000x5001/,
  );
});
