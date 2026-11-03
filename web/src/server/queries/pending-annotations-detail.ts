import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

import type {
  PendingAnnotationOverview,
  PendingAnnotationsDetail,
} from "../../domain/annotation/read-model";
import { atImageObservation } from "../experiments/public";
import { snapshot } from "../infra/db/client";
import {
  datasetImages,
  datasets,
  experimentObservationImages,
  experimentObservations,
  models,
} from "../infra/db/schema";
import { readingsSubquery } from "../readings/public";

/** How many images one listing names; the total says how many remain. */
const PENDING_ANNOTATIONS_LIST_LIMIT = 100;

/**
 * An image waits for an agent while a run on it is in progress, or while
 * nobody has reviewed it and no agent has proposed boxes for it, provided its
 * model says how to annotate.
 */
function awaiting(readings: ReturnType<typeof readingsSubquery>) {
  return or(
    isNotNull(readings.progress),
    and(
      sql`${models.annotation}->>'instructions' <> ''`,
      isNull(readings.annotation),
      isNull(readings.proposal),
    ),
  );
}

/**
 * The images in datasets and experiment observations waiting for an agent,
 * runs already at work first. One model narrows the listing to its images.
 */
export async function pendingAnnotationsDetail(
  modelId?: string,
): Promise<PendingAnnotationsDetail> {
  return snapshot(async (db) => {
    const datasetReadings = readingsSubquery(db, {
      modelId: datasets.modelId,
    });
    const observationReadings = readingsSubquery(db, {
      modelId: experimentObservations.modelId,
    });
    const [inDatasets, inExperiments] = await Promise.all([
      db
        .select({
          digest: datasetImages.imageId,
          modelId: datasets.modelId,
          filename: datasetImages.filename,
          progress: datasetReadings.progress,
        })
        .from(datasetImages)
        .innerJoin(datasets, eq(datasets.id, datasetImages.datasetId))
        .innerJoin(models, eq(models.id, datasets.modelId))
        .leftJoinLateral(
          datasetReadings,
          eq(datasetReadings.imageId, datasetImages.imageId),
        )
        .where(
          and(
            awaiting(datasetReadings),
            modelId ? eq(datasets.modelId, modelId) : undefined,
          ),
        ),
      db
        .select({
          digest: experimentObservationImages.imageId,
          modelId: experimentObservations.modelId,
          filename: experimentObservationImages.filename,
          progress: observationReadings.progress,
        })
        .from(experimentObservationImages)
        .innerJoin(experimentObservations, atImageObservation())
        .innerJoin(models, eq(models.id, experimentObservations.modelId))
        .leftJoinLateral(
          observationReadings,
          eq(observationReadings.imageId, experimentObservationImages.imageId),
        )
        .where(
          and(
            awaiting(observationReadings),
            modelId ? eq(experimentObservations.modelId, modelId) : undefined,
          ),
        ),
    ]);
    const pending = new Map<string, PendingAnnotationOverview>();
    for (const row of [...inDatasets, ...inExperiments]) {
      const key = `${row.digest}/${row.modelId}`;
      if (!pending.has(key))
        pending.set(key, {
          ref: { digest: row.digest, modelId: row.modelId },
          filename: row.filename,
          progress: row.progress,
        });
    }
    const images = [...pending.values()].sort(
      (a, b) =>
        Number(b.progress !== null) - Number(a.progress !== null) ||
        a.ref.modelId.localeCompare(b.ref.modelId) ||
        a.filename.localeCompare(b.filename) ||
        a.ref.digest.localeCompare(b.ref.digest),
    );
    return {
      total: images.length,
      images: images.slice(0, PENDING_ANNOTATIONS_LIST_LIMIT),
    };
  });
}
