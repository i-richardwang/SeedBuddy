import type { Dataset, NamedDataset } from "../datasets/schema";
import type { VersionComparison } from "../models/comparison";
import type { Model, ModelVersion } from "../models/schema";
import type { TrainingAttempt, TrainingEpoch, TrainingRun } from "./schema";
import type { TrainingRunStall } from "./stall";

export interface TrainingRunListing {
  dataset: NamedDataset;
  run: TrainingRun;
  completed: number;
  best: { map50: number; map50To95: number } | null;
}

/** Whether a training set can start a run now, and what the run would train on. */
export interface DatasetTrainingReadiness {
  /** The model's run in progress, whichever training set feeds it. */
  active: TrainingRun | null;
  reviewedSinceLastRun: number;
  /** The least memory among the online trainers, or null when none is online. */
  workerMemoryBytes: number | null;
  workers: TrainingWorkerOption[];
}

export interface VersionOverview {
  version: ModelVersion;
  /**
   * The run that trained the version, in its training set, and how many
   * images it trained on; null for a built-in or imported version.
   */
  training: { runId: string; datasetId: string; images: number } | null;
  /** Whether this is the version that reads the model's images. */
  current: boolean;
  /**
   * How the version counts the reviewed images it was held out from, beside
   * the current version; null for the current version and for one that held
   * nothing out.
   */
  comparison: VersionComparison | null;
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
  workers: TrainingWorkerOption[];
  version: ModelVersion | null;
  /** Whether the published version is the one that reads the model's images. */
  current: boolean;
}

export interface TrainingWorkerOption {
  workerId: string;
  online: boolean;
}
