import { z } from "zod";

import {
  observationImageRefSchema,
  observationRefSchema,
} from "../experiments/schema";
import { resourceIdSchema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";
import { IMAGE_SPLITS } from "../training/schema";

export const datasetIdSchema = z.uuid();

/**
 * A dataset's name is how people and other workbenches know it: transfer
 * addresses a dataset by name and a data root keeps it in a folder of that
 * name, so it stays filename-safe. Unlike the id, it can change.
 */
export const DATASET_NAME_PATTERN = "[A-Za-z0-9][A-Za-z0-9._-]{0,79}";
const DATASET_NAME = new RegExp(`^${DATASET_NAME_PATTERN}$`);
export const datasetNameSchema = z
  .string()
  .regex(
    DATASET_NAME,
    "Dataset names use letters, numbers, dots, dashes, and underscores",
  );

/** One dataset named at an API or route boundary. */
export const datasetRefSchema = z.strictObject({
  dataset: datasetIdSchema,
});

/** One image as a member of one dataset. */
export const datasetImageRefSchema = datasetRefSchema.extend({
  digest: imageDigestSchema,
});

export type DatasetImageRef = z.infer<typeof datasetImageRefSchema>;

/** A dataset trains one model; its images are reviewed for that model. */
export const datasetSchema = z.strictObject({
  id: datasetIdSchema,
  name: datasetNameSchema,
  modelId: resourceIdSchema,
});

export type Dataset = z.infer<typeof datasetSchema>;

/** A dataset by its id, with the name it is shown under. */
export type NamedDataset = Pick<Dataset, "id" | "name">;

/**
 * Experiment photographs joining a dataset: named one by one, or every
 * photograph of one observation, resolved when they are added.
 */
export const observationPhotographsSchema = z.union([
  z.array(observationImageRefSchema).min(1, "No images to add"),
  observationRefSchema,
]);

export type ObservationPhotographs = z.infer<
  typeof observationPhotographsSchema
>;

/** Experiment images founding a new dataset for their observation's model. */
export const newDatasetImageAdditionSchema = z.strictObject({
  name: datasetNameSchema,
  images: observationPhotographsSchema,
});

export type NewDatasetImageAddition = z.infer<
  typeof newDatasetImageAdditionSchema
>;

/** A new, empty dataset for one model. */
export const datasetRequestSchema = z.strictObject({
  name: datasetNameSchema,
  modelId: resourceIdSchema,
});

export type DatasetRequest = z.infer<typeof datasetRequestSchema>;

/** A dataset's new name; its images, splits, and training history stay. */
export const datasetUpdateSchema = z.strictObject({
  dataset: datasetIdSchema,
  name: datasetNameSchema,
});

export type DatasetUpdate = z.infer<typeof datasetUpdateSchema>;

/** Experiment images joining a dataset that trains their observation's model. */
export const datasetImageAdditionSchema = z.strictObject({
  dataset: datasetIdSchema,
  images: observationPhotographsSchema,
});

export type DatasetImageAddition = z.infer<typeof datasetImageAdditionSchema>;

/** What an addition changed: images new to the dataset, and those already in it. */
export const datasetImageAdditionResultSchema = z.strictObject({
  dataset: datasetSchema,
  added: z.number().int().nonnegative(),
  existing: z.number().int().nonnegative(),
});

export type DatasetImageAdditionResult = z.infer<
  typeof datasetImageAdditionResultSchema
>;

/** Images leaving a dataset; the images and their reviews remain. */
export const datasetImageRemovalSchema = z.strictObject({
  dataset: datasetIdSchema,
  digests: z.array(imageDigestSchema).min(1, "No images to remove"),
});

export type DatasetImageRemoval = z.infer<typeof datasetImageRemovalSchema>;

/** What a removal changed: images taken out, and those that were not in it. */
export const datasetImageRemovalResultSchema = z.strictObject({
  dataset: datasetSchema,
  removed: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
});

export type DatasetImageRemovalResult = z.infer<
  typeof datasetImageRemovalResultSchema
>;

/** A dataset with each image, whether it is reviewed, and its training split. */
export const datasetContentsSchema = z.strictObject({
  dataset: datasetSchema,
  images: z.array(
    z.strictObject({
      digest: imageDigestSchema,
      filename: z.string(),
      reviewed: z.boolean(),
      /** Assigned when the image first enters a snapshot. */
      split: z.enum(IMAGE_SPLITS).nullable(),
      /** Whether a person marked the photograph unclear; it trains all the same. */
      unclear: z.boolean(),
    }),
  ),
});

export type DatasetContents = z.infer<typeof datasetContentsSchema>;

/** Optionally narrows a dataset listing to those training one model. */
export const datasetListRequestSchema = z.strictObject({
  modelId: resourceIdSchema.optional(),
});
