import type { Dataset } from "../../domain/datasets/schema";
import type { Model } from "../../domain/models/schema";
import type {
  DatasetTrainingReadiness,
  TrainingRunOverview,
} from "../../domain/training/read-model";
import {
  DEFAULT_TRAINING_PRESET_ID,
  TRAINING_PRESETS,
  type TrainingPreset,
  type TrainingPresetId,
} from "../../domain/training/recipes";
import {
  countReviewed,
  type ImageOverview,
  listImageRecords,
  readDataset,
  summarize,
} from "../datasets/public";
import { readModel } from "../models/public";
import { datasetTrainingReadiness } from "./training-readiness";
import { listTrainingRunOverviews } from "./training-runs";

/**
 * What a training set's page shows: its model and images, how many are
 * reviewed and so train, the state of training with the recipe a new run
 * starts from, and the set's runs.
 */
interface DatasetDetail {
  dataset: Dataset;
  model: Model;
  images: ImageOverview[];
  reviewedCount: number;
  training: DatasetTrainingReadiness;
  trainingPresets: readonly TrainingPreset[];
  defaultTrainingPresetId: TrainingPresetId;
  runs: TrainingRunOverview[];
}

export async function datasetDetail(
  datasetId: string,
  at: Date = new Date(),
): Promise<DatasetDetail | null> {
  const dataset = await readDataset(datasetId);
  if (!dataset) return null;
  const model = await readModel(dataset.modelId);
  if (!model) throw new Error(`Unknown model: ${dataset.modelId}`);
  const records = await listImageRecords(datasetId);
  return {
    dataset,
    model,
    images: records.map(summarize),
    reviewedCount: countReviewed(records),
    training: await datasetTrainingReadiness(dataset, records, at),
    trainingPresets: TRAINING_PRESETS,
    defaultTrainingPresetId: DEFAULT_TRAINING_PRESET_ID,
    runs: await listTrainingRunOverviews({ datasetId: dataset.id }),
  };
}
