import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";

import { readBlob } from "../infra/blobs/store";
import { database, operationTime, transaction } from "../infra/db/client";
import { images } from "../infra/db/schema";
import { analyzeImage } from "./analysis";
import { DISH_RECIPE_ID } from "./dish-recipe";
import { imageBlobKey } from "./keys";

export const IMAGE_ANALYSIS_RETRY_MS = 15 * 60 * 1000;

interface RefreshOptions {
  limit?: number;
  attemptedBefore?: Date;
  signal?: AbortSignal;
}

function needsAnalysis() {
  return or(
    isNull(images.dishAnalysis),
    sql`${images.dishAnalysis}->>'recipe' <> ${DISH_RECIPE_ID}`,
  );
}

/** Claim one image in a short transaction; decoding never holds database locks. */
async function claimImage(attemptedBefore: Date) {
  return transaction(async (db) => {
    const [image] = await db
      .select({ id: images.id, width: images.width, height: images.height })
      .from(images)
      .where(
        and(
          needsAnalysis(),
          or(
            isNull(images.dishAnalysisAttemptedAt),
            lt(images.dishAnalysisAttemptedAt, attemptedBefore),
          ),
        ),
      )
      .orderBy(
        sql`${images.dishAnalysisAttemptedAt} asc nulls first`,
        asc(images.id),
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!image) return null;
    const attemptedAt = await operationTime(db);
    await db
      .update(images)
      .set({ dishAnalysisAttemptedAt: attemptedAt })
      .where(eq(images.id, image.id));
    return { ...image, attemptedAt };
  });
}

/** Failures keep their attempt time, so retries remain fair across process restarts. */
export function createImageAnalysisRefresher(analyze = analyzeImage) {
  return async ({
    limit = 100,
    attemptedBefore,
    signal,
  }: RefreshOptions = {}) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("Analysis limit must be 1–1000");
    const at = await operationTime(await database());
    attemptedBefore ??= new Date(at.getTime() - IMAGE_ANALYSIS_RETRY_MS);
    if (
      !Number.isFinite(attemptedBefore.getTime()) ||
      attemptedBefore.getTime() > at.getTime() - IMAGE_ANALYSIS_RETRY_MS
    )
      throw new Error("Analysis cutoff must respect the retry interval");
    const result = { examined: 0, completed: 0, failed: 0, skipped: 0 };
    while (result.examined < limit && !signal?.aborted) {
      const image = await claimImage(attemptedBefore);
      if (!image) break;
      result.examined++;
      // Store transport failures affect the whole service and reach scheduler backoff.
      const bytes = await readBlob(imageBlobKey(image.id));
      let analysis = null;
      try {
        if (!bytes) throw new Error("Canonical image is missing");
        analysis = await analyze({
          digest: image.id,
          width: image.width,
          height: image.height,
          bytes,
        });
      } catch (error) {
        console.error("Image analysis failed", { imageId: image.id }, error);
      }
      if (!analysis) {
        result.failed++;
        continue;
      }
      // A later ingestion or retry owns its result; stale work cannot replace it.
      const updated = await (
        await database()
      )
        .update(images)
        .set({ dishAnalysis: analysis })
        .where(
          and(
            eq(images.id, image.id),
            eq(images.dishAnalysisAttemptedAt, image.attemptedAt),
            needsAnalysis(),
          ),
        )
        .returning({ id: images.id });
      result.completed += updated.length;
      result.skipped += 1 - updated.length;
    }
    return result;
  };
}

export const refreshImageAnalysis = createImageAnalysisRefresher();
