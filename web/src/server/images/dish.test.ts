import { expect, test } from "bun:test";
import sharp from "sharp";

import { createDishDetector } from "./dish";

test("the compute thread loads its WASM runtime, locates a dish and safely returns no candidate", async () => {
  const detector = createDishDetector();
  try {
    const width = 1200,
      height = 800;
    const pixels = await sharp(
      Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><circle cx="600" cy="400" r="330" fill="none" stroke="black" stroke-width="8"/></svg>`,
      ),
    )
      .removeAlpha()
      .raw()
      .toBuffer();
    const [circle, empty] = await Promise.all([
      detector.detect({ pixels, width, height }),
      detector.detect({
        pixels: new Uint8Array(width * height * 3).fill(255),
        width,
        height,
      }),
    ]);
    expect(circle).not.toBeNull();
    expect(Math.abs(circle!.x - 600)).toBeLessThan(8);
    expect(Math.abs(circle!.y - 400)).toBeLessThan(8);
    expect(Math.abs(circle!.radius - 330)).toBeLessThan(10);
    expect(empty).toBeNull();
  } finally {
    await detector.close();
  }
});
