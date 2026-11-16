import { describe, expect, test } from "bun:test";
import sharp from "sharp";

import { encodedImageSize } from "./size";

async function encoded(
  format: "jpeg" | "png",
  width: number,
  height: number,
  withMetadata = false,
): Promise<Uint8Array> {
  let image = sharp({
    create: { width, height, channels: 3, background: "#808080" },
  });
  if (withMetadata) {
    image = image.withExif({ IFD0: { ImageDescription: "x".repeat(4000) } });
  }
  return new Uint8Array(await image[format]().toBuffer());
}

describe("encoded image size", () => {
  test("reads a JPEG's frame header", async () => {
    expect(encodedImageSize(await encoded("jpeg", 640, 480))).toEqual({
      width: 640,
      height: 480,
    });
  });

  test("walks past the segments that come before the frame", async () => {
    const bytes = await encoded("jpeg", 321, 123, true);
    expect(encodedImageSize(bytes)).toEqual({ width: 321, height: 123 });
  });

  test("reads a progressive JPEG", async () => {
    const bytes = new Uint8Array(
      await sharp({
        create: { width: 90, height: 60, channels: 3, background: "#123456" },
      })
        .jpeg({ progressive: true })
        .toBuffer(),
    );
    expect(encodedImageSize(bytes)).toEqual({ width: 90, height: 60 });
  });

  test("reads a PNG's header", async () => {
    expect(encodedImageSize(await encoded("png", 70, 30))).toEqual({
      width: 70,
      height: 30,
    });
  });

  test("answers nothing for a file cut short of the declaration", async () => {
    const bytes = await encoded("jpeg", 321, 123, true);
    expect(encodedImageSize(bytes.subarray(0, 200))).toBeNull();
  });

  test("answers nothing for other bytes", () => {
    expect(
      encodedImageSize(new Uint8Array([0x49, 0x49, 0x2a, 0x00])),
    ).toBeNull();
    expect(encodedImageSize(new Uint8Array())).toBeNull();
  });

  test("passes over fill bytes and reads no frame after the scan begins", () => {
    const frame = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x7b, 0x01, 0x41];
    const scan = [0xff, 0xda, 0x00, 0x02];
    expect(
      encodedImageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xff, ...frame])),
    ).toEqual({ width: 321, height: 123 });
    expect(
      encodedImageSize(new Uint8Array([0xff, 0xd8, ...scan, ...frame])),
    ).toBeNull();
  });

  test("answers nothing for a PNG cut short of its header", async () => {
    const bytes = await encoded("png", 321, 123);
    expect(encodedImageSize(bytes.subarray(0, 20))).toBeNull();
  });
});
