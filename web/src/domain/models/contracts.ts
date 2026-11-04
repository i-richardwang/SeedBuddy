import { z } from "zod";

const count = z.number().int().min(0);

/**
 * Everything that can name a model: its versions and uploads, the observations read for it,
 * the reviews stored against it, the datasets that train it, and the runs that
 * produced its versions. A model none of these name is a question nobody has
 * answered yet, and can be withdrawn.
 */
const modelRecordsSchema = z.strictObject({
  versions: count,
  observations: count,
  annotations: count,
  datasets: count,
  trainingRuns: count,
  uploads: count,
});

export type ModelRecords = z.infer<typeof modelRecordsSchema>;

export type ModelRecordKind = keyof ModelRecords;

export const MODEL_RECORD_KINDS = Object.keys(
  modelRecordsSchema.shape,
) as ModelRecordKind[];
