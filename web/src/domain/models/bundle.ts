import { z } from "zod";

import { resourceIdSchema, sha256Schema } from "../identifiers/schema";
import { timestampSchema } from "../time";
import {
  detectionValidationSchema,
  trainingRecipeSchema,
} from "../training/schema";
import { classListSchema } from "./classes";
import { inferenceSettingsSchema } from "./inference";
import { MAX_MODEL_WEIGHTS_BYTES } from "./transfer";

/** Executable settings supported by the Ultralytics adapter. Unsupported pipelines fail closed. */
const bundleInferenceSchema = inferenceSettingsSchema.extend({
  imageSize: z.number().int().positive().max(8192),
  maxDetections: z.number().int().positive().max(10000),
  iou: z.literal(0.7),
});

export const bundleProvenanceSchema = z.strictObject({
  dataset: z.strictObject({
    fingerprint: sha256Schema.nullable(),
    snapshotId: resourceIdSchema.nullable(),
    description: z.string().min(1).max(4000),
  }),
  selectedEpoch: z.number().int().positive().nullable(),
  codeRevision: z.string().max(200).nullable(),
  effectiveParameters: z.record(
    z.string(),
    z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
  ),
  evaluation: z.strictObject({
    description: z.string().min(1).max(4000),
    calibration: z.string().min(1).max(4000),
    metrics: z.record(z.string(), z.number().finite()),
  }),
});

/** Portable, immutable delivery document; weights are transferred separately as bytes. */
export const modelBundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  classes: classListSchema,
  weights: z.strictObject({
    digest: sha256Schema,
    bytes: z.number().int().positive().max(MAX_MODEL_WEIGHTS_BYTES),
  }),
  inference: bundleInferenceSchema,
  training: trainingRecipeSchema,
  validation: detectionValidationSchema,
  provenance: bundleProvenanceSchema,
});
export type ModelBundle = z.infer<typeof modelBundleSchema>;

export const modelImportSchema = z.strictObject({
  model: resourceIdSchema,
  bundle: modelBundleSchema,
});
export const modelUploadRefSchema = z.strictObject({
  uploadId: resourceIdSchema,
});
export const modelUploadSchema = z.strictObject({
  uploadId: resourceIdSchema,
  uploadPath: z.string(),
  expiresAt: timestampSchema,
});
