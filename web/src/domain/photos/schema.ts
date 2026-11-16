import { z } from "zod";

import { imageDigestSchema, imageFilenameSchema } from "../images/schema";
import { timestampSchema } from "../time";

const photoBatchIdSchema = z.uuid();

/** What its owner calls a batch, such as the day or the experiment it was taken for. */
const photoBatchNameSchema = z
  .string()
  .trim()
  .min(1, "A batch needs a name")
  .max(120, "The name is too long");

export const photoBatchRequestSchema = z.strictObject({
  name: photoBatchNameSchema,
});

export type PhotoBatchRequest = z.infer<typeof photoBatchRequestSchema>;

export const photoBatchRefSchema = z.strictObject({
  batch: photoBatchIdSchema,
});

export type PhotoBatchRef = z.infer<typeof photoBatchRefSchema>;

/**
 * Photographs uploaded together and not yet placed in an experiment. A batch
 * is its owner's alone.
 */
export const photoBatchSchema = z.strictObject({
  id: photoBatchIdSchema,
  name: photoBatchNameSchema,
  createdAt: timestampSchema,
});

export type PhotoBatch = z.infer<typeof photoBatchSchema>;

/** One photograph of a batch. */
export const batchPhotoRefSchema = photoBatchRefSchema.extend({
  digest: imageDigestSchema,
});

export type BatchPhotoRef = z.infer<typeof batchPhotoRefSchema>;

/** A stored photograph joining a batch under the name it was uploaded with. */
export const batchPhotoAdditionSchema = batchPhotoRefSchema.extend({
  filename: imageFilenameSchema,
});

export type BatchPhotoAddition = z.infer<typeof batchPhotoAdditionSchema>;
