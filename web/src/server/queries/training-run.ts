import type { TrainingRunDetail } from "../../domain/training/read-model";
import {
  isTrainingRunResumable,
  type TrainingRun,
} from "../../domain/training/schema";
import { trainingRunStall } from "../../domain/training/stall";
import { readDataset } from "../datasets/public";
import {
  readCurrentVersionId,
  readModel,
  readModelVersion,
} from "../models/public";
import {
  activeTrainingRun,
  listTrainingAttempts,
  listTrainingEpochs,
  readDatasetSnapshot,
  readTrainingRun,
  trainingLeaseHeld,
} from "../training/public";
import { trainingWorkerOptions } from "./training-workers";

/**
 * One run with its whole epoch history and its attempts, whether it has
 * stalled as of `at` or waits for another run of its model, the version it
 * published, and whether that version reads.
 */
export async function trainingRunDetail(
  datasetId: string,
  runId: string,
  at = new Date(),
): Promise<TrainingRunDetail | null> {
  const dataset = await readDataset(datasetId);
  const run = await readTrainingRun(runId);
  if (!dataset || !run) return null;
  const snapshot = await readDatasetSnapshot(run.datasetSnapshotId);
  if (snapshot?.datasetId !== dataset.id) return null;
  const model = await readModel(dataset.modelId);
  if (!model) throw new Error(`Unknown model: ${dataset.modelId}`);
  const version =
    run.state.status === "succeeded"
      ? await readModelVersion(run.state.modelVersionId)
      : null;
  return {
    dataset,
    model,
    run,
    stall: trainingRunStall(run, {
      at,
      leaseHeld:
        run.state.status === "running" && (await trainingLeaseHeld(runId, at)),
    }),
    blockedBy: await blockingRun(run),
    epochs: await listTrainingEpochs(runId),
    attempts: await listTrainingAttempts(runId),
    workers: await trainingWorkerOptions(),
    version,
    current:
      version !== null && (await readCurrentVersionId(model.id)) === version.id,
  };
}

/** The model's run in progress that a paused or failed run waits for. */
async function blockingRun(
  run: TrainingRun,
): Promise<TrainingRunDetail["blockedBy"]> {
  if (!isTrainingRunResumable(run)) return null;
  const active = await activeTrainingRun(run.modelId);
  if (!active) return null;
  const snapshot = await readDatasetSnapshot(active.datasetSnapshotId);
  if (!snapshot)
    throw new Error(`Unknown snapshot: ${active.datasetSnapshotId}`);
  return { runId: active.id, datasetId: snapshot.datasetId };
}
