/** Loads one observation photograph with its review and unit navigation. */
import { and, eq } from "drizzle-orm";

import type { ExperimentObservationImageDetail } from "../../domain/experiments/read-model";
import type { ObservationImageRef } from "../../domain/experiments/schema";
import {
  atImageObservation,
  atObservationImage,
  listObservations,
  requireObservation,
  toExperiment,
} from "../experiments/public";
import { markedUnclear } from "../images/public";
import { currentVersion } from "../inference/public";
import { type Executor, inSnapshot } from "../infra/db/client";
import {
  experimentObservationImages,
  experimentObservations,
  experiments,
  experimentUnits,
  inferenceTasks,
  models,
  modelVersions,
} from "../infra/db/schema";
import { toModel } from "../models/public";
import { readReview } from "../readings/public";

export function experimentObservationImageDetail(
  ref: ObservationImageRef,
  executor?: Executor,
): Promise<ExperimentObservationImageDetail | null> {
  return inSnapshot(executor, (db) => readObservationImage(ref, db));
}

async function readObservationImage(
  ref: ObservationImageRef,
  db: Executor,
): Promise<ExperimentObservationImageDetail | null> {
  const [row] = await db
    .select({
      observationImage: experimentObservationImages,
      experiment: experiments,
      unit: experimentUnits,
      model: models,
      taskStatus: inferenceTasks.status,
      taskError: inferenceTasks.error,
      versionId: modelVersions.id,
      unclear: markedUnclear(experimentObservationImages.imageId),
    })
    .from(experimentObservationImages)
    .innerJoin(
      experiments,
      eq(experiments.id, experimentObservationImages.experimentId),
    )
    .innerJoin(experimentObservations, atImageObservation())
    .innerJoin(models, eq(models.id, experimentObservations.modelId))
    .leftJoin(
      modelVersions,
      eq(modelVersions.id, currentVersion(experimentObservations.modelId)),
    )
    .innerJoin(
      experimentUnits,
      and(
        eq(
          experimentUnits.experimentId,
          experimentObservationImages.experimentId,
        ),
        eq(experimentUnits.id, experimentObservationImages.unitId),
      ),
    )
    .leftJoin(
      inferenceTasks,
      and(
        eq(inferenceTasks.imageId, experimentObservationImages.imageId),
        eq(inferenceTasks.modelVersionId, modelVersions.id),
      ),
    )
    .where(atObservationImage(ref.experiment, ref.observationImage));
  if (!row) return null;
  const experiment = toExperiment(row.experiment);
  const [observation, review] = await Promise.all([
    listObservations(ref.experiment, db).then((observations) =>
      requireObservation(observations, row.observationImage.observationId),
    ),
    readReview(
      { digest: row.observationImage.imageId, modelId: row.model.id },
      row.observationImage.filename,
      db,
    ),
  ]);
  if (!review) return null;
  return {
    ref,
    experimentName: experiment.name,
    unit: {
      id: row.unit.id,
      code: row.unit.code,
      treatment: row.unit.treatmentId,
    },
    observation,
    model: toModel(row.model),
    review,
    failure:
      row.taskStatus === "failed" && row.taskError && row.versionId
        ? {
            digest: row.observationImage.imageId,
            versionId: row.versionId,
            error: row.taskError,
          }
        : null,
    unclear: row.unclear,
  };
}
