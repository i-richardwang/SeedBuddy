import { describe, expect, test } from "bun:test";

import { reducedForUpload } from "./reduce";

/** A file that opens like a PNG declaring this size and holds no image. */
function png(width: number, height: number): File {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new File([bytes], "dish.png", { type: "image/png" });
}

describe("reducing a photograph for upload", () => {
  test("a photograph within the bound goes up as it is", async () => {
    const file = png(6240, 4160);
    expect(await reducedForUpload(file)).toBe(file);
  });

  test("a file whose header declares no size goes up as it is", async () => {
    const file = new File([new Uint8Array(64)], "dish.tif");
    expect(await reducedForUpload(file)).toBe(file);
  });

  test("a larger photograph that cannot be reduced is refused", async () => {
    await expect(reducedForUpload(png(8064, 6048))).rejects.toThrow(/26/);
  });
});
