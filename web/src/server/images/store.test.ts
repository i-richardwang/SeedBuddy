import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";

import { listBlobs } from "../infra/blobs/store";
import { database } from "../infra/db/client";
import { images } from "../infra/db/schema";
import { refreshImageAnalysis } from "./analysis-maintenance";
import { DISH_RECIPE_ID } from "./dish-recipe";
import { canonicalize } from "./ingest";
import { storeCanonicalImage, storeImage } from "./store";

async function row(digest: string) {
  return (
    await (await database()).select().from(images).where(eq(images.id, digest))
  )[0]!;
}

test("upload and canonical import persist the same analysis without preparing regional PNGs", async () => {
  const bytes = await sharp(
    Buffer.from(
      '<svg width="1000" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><circle cx="500" cy="500" r="375" stroke="black" stroke-width="8" fill="none"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const canonical = await canonicalize(bytes);
  const first = await storeImage(bytes);
  const stored = await row(first.digest);
  const analysis = stored.dishAnalysis;
  expect(stored.dishAnalysisAttemptedAt).toBeInstanceOf(Date);
  expect(first.digest).toBe(canonical.digest);
  expect(analysis?.recipe).toBe(DISH_RECIPE_ID);
  expect(analysis?.circle).not.toBeNull();
  expect(await listBlobs(`image-regions/${first.digest}/`)).toEqual([]);
  expect(await storeCanonicalImage(canonical.digest, canonical.bytes)).toEqual(
    first,
  );
  expect((await row(first.digest)).dishAnalysis).toEqual(analysis);
  expect((await row(first.digest)).dishAnalysisAttemptedAt).toEqual(
    stored.dishAnalysisAttemptedAt,
  );
  await (
    await database()
  )
    .update(images)
    .set({ dishAnalysis: null })
    .where(eq(images.id, first.digest));
  await storeCanonicalImage(canonical.digest, canonical.bytes);
  expect((await row(first.digest)).dishAnalysis).toEqual(analysis);
});

test("maintenance refreshes only unavailable or obsolete analysis, including successful no-candidate results", async () => {
  const source = await sharp({
    create: {
      width: 123,
      height: 97,
      channels: 3,
      background: { r: 140, g: 153, b: 166 },
    },
  })
    .png()
    .toBuffer();
  const image = await storeImage(source);
  const original = (await row(image.digest)).dishAnalysis;
  expect(original).toEqual({ recipe: DISH_RECIPE_ID, circle: null });
  await (
    await database()
  )
    .update(images)
    .set({
      dishAnalysis: { recipe: "b".repeat(64), circle: null },
      dishAnalysisAttemptedAt: null,
    })
    .where(eq(images.id, image.digest));
  const result = await refreshImageAnalysis({ limit: 1000 });
  expect(result.completed).toBeGreaterThanOrEqual(1);
  expect(result.failed).toBe(0);
  expect((await row(image.digest)).dishAnalysis).toEqual(original);
  const warm = await refreshImageAnalysis({ limit: 1000 });
  expect(warm).toEqual({ examined: 0, completed: 0, failed: 0, skipped: 0 });
});

test("database analysis constraints distinguish unavailable metadata from completed no-candidate results", async () => {
  const source = await sharp({
    create: { width: 83, height: 61, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const image = await storeImage(source);
  const db = await database();
  for (const invalid of [
    { recipe: null, circle: null },
    { recipe: DISH_RECIPE_ID, circle: { x: 40, y: 30, radius: -1 } },
    { recipe: DISH_RECIPE_ID, circle: { x: 83, y: 30, radius: 25 } },
  ]) {
    await expect(
      db
        .update(images)
        .set({ dishAnalysis: sql`${JSON.stringify(invalid)}::jsonb` })
        .where(eq(images.id, image.digest))
        .execute(),
    ).rejects.toThrow();
  }
  expect((await row(image.digest)).dishAnalysis).toEqual({
    recipe: DISH_RECIPE_ID,
    circle: null,
  });
});
