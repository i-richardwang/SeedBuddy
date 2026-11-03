import { z } from "zod";

import { timestampSchema, resourceIdSchema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";
import { classListSchema } from "../models/classes";
import {
  modelArtifactSchema,
  type Model,
  type ModelVersion,
} from "../models/schema";

export const inferenceModelManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  modelVersionId: resourceIdSchema,
  classes: classListSchema,
  artifact: modelArtifactSchema,
});

export const inferenceAssignmentSchema = z.strictObject({
  manifest: inferenceModelManifestSchema,
  image: imageDigestSchema,
  attempt: z.number().int().positive(),
  leaseExpiresAt: timestampSchema,
  deadlineAt: timestampSchema,
  serverTime: timestampSchema,
});

export const inferenceTargetSchema = z.strictObject({
  versionId: resourceIdSchema,
  digest: imageDigestSchema,
});

export type InferenceModelManifest = z.infer<
  typeof inferenceModelManifestSchema
>;
export type InferenceAssignment = z.infer<typeof inferenceAssignmentSchema>;

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
