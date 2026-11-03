import type { AnnotationDocument } from "../../domain/annotation/schema";
import type { DatasetTrainingReadiness } from "../../domain/datasets/read-model";
import type { Dataset } from "../../domain/datasets/schema";
import type { TrainingRun } from "../../domain/training/schema";
import { canonicalJson } from "../../lib/json/canonical";
import type { ImageRecord } from "../datasets/public";
import type { Executor } from "../infra/db/client";
import {
  activeTrainingRun,
  latestTrainingRun,
  readDatasetSnapshot,
} from "../training/public";
import { listOnlineTrainers } from "../workers/public";
import { listTrainingWorkerOverviews } from "./list-training-worker-overviews";

/**
 * Reviews the last run did not train on: images reviewed since, and images
 * whose review has changed since the snapshot froze it.
 */
async function reviewedSinceLastRun(
  records: ImageRecord[],
  latest: TrainingRun | null,
  db: Executor,
): Promise<number> {
  const snapshot = latest
    ? await readDatasetSnapshot(latest.datasetSnapshotId, db)
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
  return canonicalJson(
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
  db: Executor,
): Promise<DatasetTrainingReadiness> {
  const [online, active, latest] = await Promise.all([
    listOnlineTrainers(at, db),
    activeTrainingRun(dataset.modelId, db),
    latestTrainingRun(dataset.id, db),
  ]);
  return {
    active,
    workers: await listTrainingWorkerOverviews(at, db),
    reviewedSinceLastRun: await reviewedSinceLastRun(records, latest, db),
    workerMemoryBytes: online.length
      ? Math.min(...online.map((worker) => worker.memoryBytes))
      : null,
  };
}
