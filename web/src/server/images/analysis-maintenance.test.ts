import { afterEach, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { putImmutableBlob, removeBlob } from "../infra/blobs/store";
import { database, transaction } from "../infra/db/client";
import { images } from "../infra/db/schema";
import {
  createImageAnalysisRefresher,
  IMAGE_ANALYSIS_RETRY_MS,
} from "./analysis-maintenance";
import { DISH_RECIPE_ID } from "./dish-recipe";
import { imageBlobKey } from "./keys";

const inserted: string[] = [];
let sequence = 0;
const completed = { recipe: DISH_RECIPE_ID, circle: null };

async function fixture(
  options: { missing?: boolean; attemptedAt?: Date } = {},
) {
  const id = (++sequence).toString(16).padStart(64, "0");
  inserted.push(id);
  await (await database()).insert(images).values({
    id,
    width: 1000,
    height: 1000,
    bytes: 1,
    /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
    receivedAt: new Date(),
    dishAnalysisAttemptedAt: options.attemptedAt ?? null,
  });
  if (!options.missing)
    await putImmutableBlob(imageBlobKey(id), new Uint8Array([1]));
  return id;
}

async function row(id: string) {
  return (
    await (await database()).select().from(images).where(eq(images.id, id))
  )[0]!;
}

afterEach(async () => {
  if (!inserted.length) return;
  await (await database()).delete(images).where(inArray(images.id, inserted));
  for (const id of inserted) await removeBlob(imageBlobKey(id));
  inserted.length = 0;
});

test("failures larger than a batch cannot starve later images, even with a new refresher", async () => {
  const failures = new Set<string>();
  for (let i = 0; i < 5; i++) failures.add(await fixture());
  const valid = await fixture();
  const analyze: Parameters<typeof createImageAnalysisRefresher>[0] = async (
    image,
  ) => (failures.has(image.digest) ? null : completed);
  for (let i = 0; i < 2; i++)
    expect(await createImageAnalysisRefresher(analyze)({ limit: 2 })).toEqual({
      attemptedBefore: expect.any(Date),
      examined: 2,
      completed: 0,
      failed: 2,
      skipped: 0,
    });
  expect(await createImageAnalysisRefresher(analyze)({ limit: 2 })).toEqual({
    attemptedBefore: expect.any(Date),
    examined: 2,
    completed: 1,
    failed: 1,
    skipped: 0,
  });
  expect((await row(valid)).dishAnalysis).toEqual(completed);
  for (const id of failures)
    expect((await row(id)).dishAnalysisAttemptedAt).toBeInstanceOf(Date);
  expect(await createImageAnalysisRefresher(analyze)({ limit: 1 })).toEqual({
    attemptedBefore: expect.any(Date),
    examined: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  });
});

test("untried images precede eligible retries, and recent failures stay in cooldown", async () => {
  const old = await fixture({
    /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
    attemptedAt: new Date(Date.now() - 2 * IMAGE_ANALYSIS_RETRY_MS),
  });
  /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
  const fresh = await fixture({ attemptedAt: new Date() });
  const untried = await fixture();
  const calls: string[] = [];
  const refresh = createImageAnalysisRefresher(async (image) => {
    calls.push(image.digest);
    return null;
  });
  await refresh({ limit: 2 });
  expect(calls).toEqual([untried, old]);
  expect((await row(fresh)).dishAnalysis).toBeNull();
  await (
    await database()
  )
    .update(images)
    .set({
      dishAnalysisAttemptedAt: new Date(
        /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
        Date.now() - 2 * IMAGE_ANALYSIS_RETRY_MS,
      ),
    })
    .where(eq(images.id, fresh));
  await refresh({ limit: 1 });
  expect(calls).toEqual([untried, old, fresh]);
});

test("missing and corrupt images fail individually without aborting later work", async () => {
  const missing = await fixture({ missing: true });
  const corrupt = await fixture();
  const valid = await fixture();
  const refresh = createImageAnalysisRefresher(async (image) => {
    if (image.digest === corrupt) throw new Error("Corrupt canonical pixels");
    return completed;
  });
  expect(await refresh({ limit: 3 })).toEqual({
    attemptedBefore: expect.any(Date),
    examined: 3,
    completed: 1,
    failed: 2,
    skipped: 0,
  });
  expect((await row(valid)).dishAnalysis).toEqual(completed);
  expect((await row(missing)).dishAnalysisAttemptedAt).toBeInstanceOf(Date);
});

test("concurrent refreshers claim different images and do not hold locks during analysis", async () => {
  const first = await fixture();
  const second = await fixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const calls: string[] = [];
  const analyze: Parameters<typeof createImageAnalysisRefresher>[0] = async (
    image,
  ) => {
    calls.push(image.digest);
    if (image.digest === first) {
      entered.resolve();
      await release.promise;
    }
    return completed;
  };
  const pending = createImageAnalysisRefresher(analyze)({ limit: 1 });
  try {
    await entered.promise;
    expect(await createImageAnalysisRefresher(analyze)({ limit: 1 })).toEqual({
      attemptedBefore: expect.any(Date),
      examined: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
    });
    expect(calls).toEqual([first, second]);
  } finally {
    release.resolve();
    await pending;
  }
  expect((await row(first)).dishAnalysis).toEqual(completed);
});

test.skipIf(process.env.DATABASE_URL?.startsWith("pglite://") ?? false)(
  "a locked image does not block another PostgreSQL maintenance claim",
  async () => {
    const first = await fixture();
    const second = await fixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const locked = transaction(async (db) => {
      await db.select().from(images).where(eq(images.id, first)).for("update");
      entered.resolve();
      await release.promise;
    });
    try {
      await entered.promise;
      const calls: string[] = [];
      await createImageAnalysisRefresher(async (image) => {
        calls.push(image.digest);
        return completed;
      })({ limit: 1 });
      expect(calls).toEqual([second]);
      expect((await row(first)).dishAnalysisAttemptedAt).toBeNull();
    } finally {
      release.resolve();
      await locked;
    }
  },
);

test("a late refresh preserves newer ingestion and reports the result as skipped", async () => {
  const id = await fixture();
  const newer = {
    recipe: DISH_RECIPE_ID,
    circle: { x: 500, y: 500, radius: 400 },
  };
  const refresh = createImageAnalysisRefresher(async () => {
    await (
      await database()
    )
      .update(images)
      .set({
        dishAnalysis: newer,
        /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
        dishAnalysisAttemptedAt: new Date(Date.now() + 1),
      })
      .where(eq(images.id, id));
    return completed;
  });
  expect(await refresh({ limit: 1 })).toEqual({
    attemptedBefore: expect.any(Date),
    examined: 1,
    completed: 0,
    failed: 0,
    skipped: 1,
  });
  expect((await row(id)).dishAnalysis).toEqual(newer);
});

test("deletion during analysis is skipped while later results are persisted", async () => {
  const deleted = await fixture();
  const valid = await fixture();
  const refresh = createImageAnalysisRefresher(async (image) => {
    if (image.digest === deleted)
      await (await database()).delete(images).where(eq(images.id, deleted));
    return completed;
  });
  const result = await refresh({ limit: 2 });
  expect(result).toEqual({
    attemptedBefore: expect.any(Date),
    examined: 2,
    completed: 1,
    failed: 0,
    skipped: 1,
  });
  expect(result.examined).toBe(
    result.completed + result.failed + result.skipped,
  );
  expect((await row(valid)).dishAnalysis).toEqual(completed);
});

test("a fixed sweep cutoff excludes failures even after their cooldown expires", async () => {
  const id = await fixture();
  /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
  const attemptedBefore = new Date(Date.now() - 3 * IMAGE_ANALYSIS_RETRY_MS);
  const refresh = createImageAnalysisRefresher(async () => null);
  expect(await refresh({ limit: 1, attemptedBefore })).toEqual({
    attemptedBefore,
    examined: 1,
    completed: 0,
    failed: 1,
    skipped: 0,
  });
  // Represents a long sweep: the attempt is retryable, but occurred after its cutoff.
  await (
    await database()
  )
    .update(images)
    .set({
      dishAnalysisAttemptedAt: new Date(attemptedBefore.getTime() + 1000),
    })
    .where(eq(images.id, id));
  expect(await refresh({ limit: 1, attemptedBefore })).toEqual({
    attemptedBefore,
    examined: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  });
});

test("shutdown finishes the current image and leaves the next one unclaimed", async () => {
  await fixture();
  const next = await fixture();
  const stop = new AbortController();
  const refresh = createImageAnalysisRefresher(async () => {
    stop.abort();
    return completed;
  });
  expect(await refresh({ limit: 2, signal: stop.signal })).toEqual({
    attemptedBefore: expect.any(Date),
    examined: 1,
    completed: 1,
    failed: 0,
    skipped: 0,
  });
  expect((await row(next)).dishAnalysisAttemptedAt).toBeNull();
});
