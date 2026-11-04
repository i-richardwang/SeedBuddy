import type { Dataset, NamedDataset } from "../datasets/schema";
import type { Model, ModelVersion } from "../models/schema";
import type { TrainingWorkerOverview } from "../workers/read-model";
import type { TrainingAttempt, TrainingEpoch, TrainingRun } from "./schema";
import type { TrainingRunStall } from "./stall";

export interface TrainingRunOverview {
  dataset: NamedDataset;
  run: TrainingRun;
  completed: number;
  best: { map50: number; map50To95: number } | null;
}

export interface TrainingRunDetail {
  dataset: Dataset;
  /** The model the run's training set trains. */
  model: Model;
  run: TrainingRun;
  /** Why the running run has stopped moving, judged when it was read. */
  stall: TrainingRunStall | null;
  /**
   * The model's run in progress, which a paused or failed run waits for
   * before it can continue, named with the training set it trains on.
   */
  blockedBy: { runId: string; datasetId: string } | null;
  epochs: TrainingEpoch[];
  /** Each time a worker took the run up, the latest first. */
  attempts: TrainingAttempt[];
  workers: TrainingWorkerOverview[];
  version: ModelVersion | null;
  /** Whether the published version is the one that reads the model's images. */
  current: boolean;
}
