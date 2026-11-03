import { expect, test } from "bun:test";

import cases from "../../../../tests/fixtures/dish-geometry.json";
import { dishCoverage, dishThumbnail, intersectsCoverage } from "./coverage";
import { imageRegions } from "./regions";

test("coverage rejects invalid detections and retains tangent cores with the safety margin", () => {
  const frame = { digest: "a".repeat(64), width: 1000, height: 800 };
  for (const value of [
    null,
    { x: -1, y: 400, radius: 300 },
    { x: 1000, y: 400, radius: 300 },
    { x: 500, y: 400, radius: 20 },
    { x: 500, y: 400, radius: Infinity },
  ])
    expect(dishCoverage(frame, value)).toBeNull();
  const coverage = dishCoverage(frame, { x: 500, y: 400, radius: 300 })!;
  expect(
    intersectsCoverage({ x: 845, y: 400, width: 10, height: 10 }, coverage),
  ).toBe(true);
  expect(
    intersectsCoverage({ x: 846, y: 400, width: 10, height: 10 }, coverage),
  ).toBe(false);
  expect(intersectsCoverage({ x: 0, y: 0, width: 1, height: 1 }, null)).toBe(
    true,
  );
});

test("filtering keeps grid identity, exact halos and boundary cores and composes with redraw scope", () => {
  const frame = { digest: "a".repeat(64), width: 1000, height: 1000 };
  const layout = { coreSize: 100, halo: 32, displayScale: 2 };
  const coverage = dishCoverage(frame, { x: 500, y: 500, radius: 350 })!;
  const grid = imageRegions(frame, layout);
  const kept = imageRegions(frame, layout, null, coverage);
  expect(kept.length).toBeLessThan(grid.length);
  expect(
    kept.every((region) =>
      grid.some(
        (original) => JSON.stringify(original) === JSON.stringify(region),
      ),
    ),
  ).toBe(true);
  expect(kept.some((region) => region.id === "tile-000-000")).toBe(false);
  const scope = [{ x: 200, y: 200, width: 100, height: 100 }];
  expect(imageRegions(frame, layout, scope, coverage)).toEqual(
    grid.filter((region) => region.id === "tile-002-002"),
  );
});

test("shared native/server boundary cases keep quantized radii and use identical thumbnail rounding", () => {
  for (const sample of cases) {
    const { width, height } = dishThumbnail(sample.frame);
    expect([width, height]).toEqual(sample.thumbnail);
    expect(dishCoverage(sample.frame, sample.circle) !== null).toBe(
      sample.valid,
    );
  }
});
