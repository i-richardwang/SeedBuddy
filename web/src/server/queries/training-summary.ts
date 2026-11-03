import type { AnnotationDocument } from "../../domain/annotation/schema";
import type { Dataset } from "../../domain/datasets/schema";
import type { DatasetTrainingReadiness } from "../../domain/training/read-model";
import type { TrainingRun } from "../../domain/training/schema";
import type { ImageRecord } from "../datasets/public";
import {
  activeTrainingRun,
  latestTrainingRun,
  readDatasetSnapshot,
} from "../training/public";
import { listOnlineTrainers } from "../workers/public";
import { trainingWorkerOptions } from "./training-workers";

/**
 * Reviews the last run did not train on: images reviewed since, and images
 * whose review has changed since the snapshot froze it.
 */
async function reviewedSinceLastRun(
  records: ImageRecord[],
  latest: TrainingRun | undefined,
): Promise<number> {
  const snapshot = latest
    ? await readDatasetSnapshot(latest.datasetSnapshotId)
    : null;
  const trained = new Map(
    snapshot?.images.map((image) => [image.digest, boxes(image.annotation)]) ??
      [],
  );
  return records.filter(
    ({ image, annotation }) =>
      annotation !== null && trained.get(image.digest) !== boxes(annotation),
  ).length;
}

/** The boxes of a review in a form two reviews can be compared by. */
function boxes(annotation: AnnotationDocument): string {
  return JSON.stringify(
    annotation.instances.map(({ id, class: className, bbox }) => [
      id,
      className,
      bbox.x,
      bbox.y,
      bbox.width,
      bbox.height,
    ]),
  );
}

/**
 * Readiness is the dataset's own; the active run is the model's, because one
 * run at a time trains a model whichever dataset feeds it.
 */
export async function datasetTrainingReadiness(
  dataset: Dataset,
  records: ImageRecord[],
  at: Date,
): Promise<DatasetTrainingReadiness> {
  const [online, active, latest] = await Promise.all([
    listOnlineTrainers(at),
    activeTrainingRun(dataset.modelId),
    latestTrainingRun(dataset.id),
  ]);
  return {
    active,
    workers: await trainingWorkerOptions(at),
    reviewedSinceLastRun: await reviewedSinceLastRun(
      records,
      latest ?? undefined,
    ),
    workerMemoryBytes: online.length
      ? Math.min(...online.map((worker) => worker.memoryBytes))
      : null,
  };
}
