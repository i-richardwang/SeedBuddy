import { z } from "zod";

import { resourceIdSchema } from "../identifiers/schema";
import { imageCoverageSchema } from "../images/coverage";
import { imageDigestSchema } from "../images/schema";
import { classListSchema } from "../models/classes";
import {
  type Model,
  type ModelVersion,
  modelArtifactSchema,
} from "../models/schema";
import { timestampSchema } from "../time";

export const inferenceModelManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  modelVersionId: resourceIdSchema,
  classes: classListSchema,
  artifact: modelArtifactSchema,
});

/**
 * One execution of a version over an image. A `dish` version is handed the
 * dish coverage the image's analysis holds when the task is claimed, and
 * reads the frame it bounds; null reads the whole image, as a `whole_image`
 * version always does.
 */
export const inferenceAssignmentSchema = z.strictObject({
  manifest: inferenceModelManifestSchema,
  image: imageDigestSchema,
  coverage: imageCoverageSchema.nullable(),
  attempt: z.number().int().positive(),
  leaseExpiresAt: timestampSchema,
  deadlineAt: timestampSchema,
  serverTime: timestampSchema,
});

export const inferenceTargetSchema = z.strictObject({
  versionId: resourceIdSchema,
  digest: imageDigestSchema,
});

type InferenceModelManifest = z.infer<typeof inferenceModelManifestSchema>;

export function inferenceModelManifest(
  version: Pick<ModelVersion, "id" | "artifact">,
  model: Pick<Model, "classes">,
): InferenceModelManifest {
  return inferenceModelManifestSchema.parse({
    schemaVersion: 1,
    modelVersionId: version.id,
    classes: model.classes,
    artifact: version.artifact,
  });
}

export type InferenceTarget = z.infer<typeof inferenceTargetSchema>;
