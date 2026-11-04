import type { DatasetDetail } from "../../domain/datasets/read-model";
import {
  DEFAULT_TRAINING_PRESET_ID,
  TRAINING_PRESETS,
} from "../../domain/training/recipes";
import {
  countReviewedDatasetImages,
  listImageRecords,
  readDataset,
  summarizeDatasetImage,
} from "../datasets/public";
import { operationTime, snapshot } from "../infra/db/client";
import { requireModel } from "../models/public";
import { datasetTrainingReadiness } from "./dataset-training-readiness";
import { listTrainingRunOverviews } from "./list-training-run-overviews";

export async function datasetDetail(
  datasetId: string,
  suppliedAt?: Date,
): Promise<DatasetDetail | null> {
  return snapshot(async (db) => {
    const at = await operationTime(db, suppliedAt);
    const dataset = await readDataset(datasetId, db);
    if (!dataset) return null;
    const model = await requireModel(dataset.modelId, db);
    const records = await listImageRecords(datasetId, db);
    return {
      dataset,
      model,
      images: records.map(summarizeDatasetImage),
      reviewedCount: countReviewedDatasetImages(records),
      training: await datasetTrainingReadiness(dataset, records, at, db),
      trainingPresets: TRAINING_PRESETS,
      defaultTrainingPresetId: DEFAULT_TRAINING_PRESET_ID,
      runs: await listTrainingRunOverviews({ datasetId: dataset.id }, db),
    };
  });
}
