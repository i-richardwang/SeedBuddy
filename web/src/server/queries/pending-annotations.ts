import {
  and,
  eq,
  isNotNull,
  isNull,
  notExists,
  or,
  type SQLWrapper,
  sql,
} from "drizzle-orm";

import type { AnnotationRef } from "../../domain/annotation/schema";
import type { AnnotationProgress } from "../../domain/annotation-runs/schema";
import { database } from "../infra/db/client";
import {
  annotations,
  datasetImages,
  datasets,
  experimentObservationImages,
  experimentObservations,
  models,
} from "../infra/db/schema";
import { activeReadingJoin, proposalRunId } from "../readings/public";

/** How many images one listing names; the total says how many remain. */
const LISTED = 100;

interface PendingAnnotation {
  ref: AnnotationRef;
  filename: string;
  /** The progress of the run already at work on it, which an agent continues. */
  progress: AnnotationProgress | null;
}

/**
 * An image waits for an agent while a run on it is in progress, or while
 * nobody has reviewed it and no agent has proposed boxes for it, provided its
 * model says how to annotate.
 */
function awaiting(imageId: SQLWrapper, modelId: SQLWrapper) {
  const { run: activeRuns } = activeReadingJoin(imageId, modelId);
  const unread = and(
    sql`${models.annotation}->>'instructions' <> ''`,
    notExists(
      sql`(select 1 from ${annotations} where ${annotations.imageId} = ${imageId} and ${annotations.modelId} = ${modelId})`,
    ),
    isNull(proposalRunId(imageId, modelId)),
  );
  return or(isNotNull(activeRuns.id), unread);
}

/**
 * The images in datasets and experiment observations waiting for an agent,
 * runs already at work first. One model narrows the listing to its images.
 */
export async function listPendingAnnotations(modelId?: string): Promise<{
  total: number;
  images: PendingAnnotation[];
}> {
  const db = await database();
  const datasetActive = activeReadingJoin(
    datasetImages.imageId,
    datasets.modelId,
  );
  const observationActive = activeReadingJoin(
    experimentObservationImages.imageId,
    experimentObservations.modelId,
  );
  const { run: activeRuns } = datasetActive;
  const progress = {
    completed: activeRuns.completed,
    total: activeRuns.total,
  };
  const [inDatasets, inExperiments] = await Promise.all([
    datasetActive
      .apply(
        db
          .select({
            digest: datasetImages.imageId,
            modelId: datasets.modelId,
            filename: datasetImages.filename,
            progress,
          })
          .from(datasetImages)
          .innerJoin(datasets, eq(datasets.id, datasetImages.datasetId))
          .innerJoin(models, eq(models.id, datasets.modelId))
          .$dynamic(),
      )
      .where(
        and(
          awaiting(datasetImages.imageId, datasets.modelId),
          modelId ? eq(datasets.modelId, modelId) : undefined,
        ),
      ),
    observationActive
      .apply(
        db
          .select({
            digest: experimentObservationImages.imageId,
            modelId: experimentObservations.modelId,
            filename: experimentObservationImages.filename,
            progress,
          })
          .from(experimentObservationImages)
          .innerJoin(
            experimentObservations,
            and(
              eq(
                experimentObservations.experimentId,
                experimentObservationImages.experimentId,
              ),
              eq(
                experimentObservations.id,
                experimentObservationImages.observationId,
              ),
            ),
          )
          .innerJoin(models, eq(models.id, experimentObservations.modelId))
          .$dynamic(),
      )
      .where(
        and(
          awaiting(
            experimentObservationImages.imageId,
            experimentObservations.modelId,
          ),
          modelId ? eq(experimentObservations.modelId, modelId) : undefined,
        ),
      ),
  ]);
  const pending = new Map<string, PendingAnnotation>();
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
  return { total: images.length, images: images.slice(0, LISTED) };
}
