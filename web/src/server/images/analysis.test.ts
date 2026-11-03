import { expect, test } from "bun:test";
import sharp from "sharp";

import { createImageAnalyzer, resolveDishCoverage } from "./analysis";
import { DISH_RECIPE_ID } from "./dish-recipe";
import { canonicalize } from "./ingest";

async function image() {
  const pixels = Buffer.alloc(1600 * 1000 * 3);
  for (let i = 0; i < pixels.length; i++)
    pixels[i] = (i * 13 + Math.floor(i / 4800)) % 256;
  const source = await sharp(pixels, {
    raw: { width: 1600, height: 1000, channels: 3 },
  })
    .png()
    .toBuffer();
  return canonicalize(source);
}

test("analysis uses canonical thumbnail pixels and stores only recipe and source geometry", async () => {
  const canonical = await image();
  const analyze = createImageAnalyzer(async ({ pixels, width, height }) => {
    expect([width, height]).toEqual([1200, 750]);
    expect(pixels.byteLength).toBe(width * height * 3);
    const decoded = await sharp(canonical.bytes).raw().toBuffer();
    const expected = await sharp(decoded, {
      raw: { width: canonical.width, height: canonical.height, channels: 3 },
    })
      .resize(width, height, { kernel: "lanczos3" })
      .raw()
      .toBuffer();
    expect(pixels).toEqual(expected);
    return { x: 600, y: 375, radius: 300 };
  });
  const analysis = await analyze(canonical);
  expect(analysis).toEqual({
    recipe: DISH_RECIPE_ID,
    circle: { x: 800, y: 500, radius: 400 },
  });
  expect(
    resolveDishCoverage({ ...canonical, dishAnalysis: analysis }).coverage
      ?.margin,
  ).toBe(0.15);
});

test("no candidate is completed analysis, failures remain unavailable and stale recipes keep all cores", async () => {
  const canonical = await image();
  const absent = await createImageAnalyzer(async () => null)(canonical);
  expect(absent).toEqual({ recipe: DISH_RECIPE_ID, circle: null });
  let calls = 0;
  const analyze = createImageAnalyzer(async () => {
    if (++calls === 1) throw new Error("temporary runtime failure");
    return { x: 600, y: 375, radius: 300 };
  });
  expect(await analyze(canonical)).toBeNull();
  expect(await analyze(canonical)).not.toBeNull();
  expect(resolveDishCoverage({ ...canonical, dishAnalysis: null })).toEqual({
    coverage: null,
    fallback: "pending",
  });
  expect(resolveDishCoverage({ ...canonical, dishAnalysis: absent })).toEqual({
    coverage: null,
    fallback: "no-candidate",
  });
  expect(
    resolveDishCoverage({
      ...canonical,
      dishAnalysis: {
        recipe: "a".repeat(64),
        circle: { x: 800, y: 500, radius: 400 },
      },
    }),
  ).toEqual({ coverage: null, fallback: "obsolete" });
});
