import type { DatasetDetail } from "../../domain/datasets/read-model";
import {
  DEFAULT_TRAINING_PRESET_ID,
  TRAINING_PRESETS,
} from "../../domain/training/recipes";
import {
  countReviewed,
  listImageRecords,
  readDataset,
  summarize,
} from "../datasets/public";
import { readModel } from "../models/public";
import { datasetTrainingReadiness } from "./dataset-training-readiness";
import { listTrainingRunOverviews } from "./list-training-run-overviews";

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
