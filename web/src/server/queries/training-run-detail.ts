import type { TrainingRunDetail } from "../../domain/training/read-model";
import {
  isTrainingRunResumable,
  type TrainingRun,
} from "../../domain/training/schema";
import { trainingRunStall } from "../../domain/training/stall";
import { readDataset } from "../datasets/public";
import { type Executor, operationTime, snapshot } from "../infra/db/client";
import {
  readCurrentVersionId,
  readModelVersion,
  requireModel,
} from "../models/public";
import {
  activeTrainingRun,
  listTrainingAttempts,
  listTrainingEpochs,
  readTrainingRun,
  requireSnapshot,
  trainingLeaseIsHeld,
} from "../training/public";
import { listTrainingWorkerOverviews } from "./list-training-worker-overviews";

/**
 * One run with its whole epoch history and its attempts, whether it has
 * stalled as of `at` or waits for another run of its model, the version it
 * published, and whether that version reads.
 */
export async function trainingRunDetail(
  datasetId: string,
  runId: string,
  suppliedAt?: Date,
): Promise<TrainingRunDetail | null> {
  return snapshot(async (db) => {
    const at = await operationTime(db, suppliedAt);
    const dataset = await readDataset(datasetId, db);
    const run = await readTrainingRun(runId, db);
    if (!dataset || !run) return null;
    const snapshot = await requireSnapshot(run.datasetSnapshotId, db);
    if (snapshot.datasetId !== dataset.id) return null;
    const model = await requireModel(dataset.modelId, db);
    const version =
      run.state.status === "succeeded"
        ? await readModelVersion(run.state.modelVersionId, db)
        : null;
    return {
      dataset,
      model,
      run,
      stall: trainingRunStall(run, {
        at,
        leaseHeld:
          run.state.status === "running" &&
          (await trainingLeaseIsHeld(runId, at, db)),
      }),
      blockedBy: await blockingRun(run, db),
      epochs: await listTrainingEpochs(runId, db),
      attempts: await listTrainingAttempts(runId, db),
      workers: await listTrainingWorkerOverviews(at, db),
      version,
      current:
        version !== null &&
        (await readCurrentVersionId(model.id, db)) === version.id,
    };
  });
}

/** The model's run in progress that a paused or failed run waits for. */
async function blockingRun(
  run: TrainingRun,
  db: Executor,
): Promise<TrainingRunDetail["blockedBy"]> {
  if (!isTrainingRunResumable(run)) return null;
  const active = await activeTrainingRun(run.modelId, db);
  if (!active) return null;
  const snapshot = await requireSnapshot(active.datasetSnapshotId, db);
  return { runId: active.id, datasetId: snapshot.datasetId };
}
