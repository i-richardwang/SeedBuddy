import { z } from "zod";

import type { Review } from "../annotation/readings";
import type { DetectionQuality } from "../detection/schema";
import type { Model } from "../models/schema";
import type { ImageSplit, TrainingRun } from "../training/schema";
import type { TrainingWorkerOverview } from "../workers/read-model";
import type { Dataset, DatasetImageRef } from "./schema";
import { datasetSchema } from "./schema";

export interface DatasetImageStep {
  digest: string;
  filename: string;
}

export interface DatasetImageDetail {
  dataset: Dataset;
  model: Model;
  review: Review;
  /** Whether a person marked the photograph unclear. */
  unclear: boolean;
  split: ImageSplit | null;
  /** Where the image stands in the dataset's order, counted from 1. */
  position: { index: number; total: number };
  previous: DatasetImageStep | null;
  next: DatasetImageStep | null;
  /** The first image after this one, wrapping around, that nobody has reviewed. */
  nextUnreviewed: DatasetImageStep | null;
}

import type { TrainingRunOverview } from "../training/read-model";
import type { TrainingPreset, TrainingPresetId } from "../training/recipes";
/**
 * What a training set's page shows: its model and images, how many are
 * reviewed and so train, the state of training with the recipe a new run
 * starts from, and the set's runs.
 */
export interface DatasetDetail {
  dataset: Dataset;
  model: Model;
  images: DatasetImageOverview[];
  reviewedCount: number;
  training: DatasetTrainingReadiness;
  trainingPresets: readonly TrainingPreset[];
  defaultTrainingPresetId: TrainingPresetId;
  runs: TrainingRunOverview[];
}

/** A dataset with its size; only reviewed images are used for training. */
export const datasetOverviewSchema = z.strictObject({
  dataset: datasetSchema,
  imageCount: z.number().int().nonnegative(),
  reviewedCount: z.number().int().nonnegative(),
});

export type DatasetOverview = z.infer<typeof datasetOverviewSchema>;

export interface DatasetTrainingReadiness {
  /** The model's run in progress, whichever training set feeds it. */
  active: TrainingRun | null;
  reviewedSinceLastRun: number;
  /** The least memory among the online trainers, or null when none is online. */
  workerMemoryBytes: number | null;
  workers: TrainingWorkerOverview[];
}

export interface DatasetImageOverview extends DatasetImageRef {
  filename: string;
  /** Boxes of the newest detection, or null until a version has run. */
  detectionCount: number | null;
  /** Boxes of the newest AI proposal, or null until an agent has drawn one. */
  proposalCount: number | null;
  /** Boxes of the stored review, or null until someone has reviewed the image. */
  reviewCount: number | null;
  quality: DetectionQuality | null;
  /** Whether a person marked the photograph unclear; it trains all the same. */
  unclear: boolean;
}
