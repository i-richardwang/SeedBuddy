import { z } from "zod";

import { canonicalJson } from "../../lib/json/canonical";
import { resourceIdSchema, sha256Schema } from "../identifiers/schema";
import type { RuntimeDescriptor } from "../inference/schema";
import { timestampSchema } from "../time";
import {
  detectionValidationSchema,
  trainingRecipeSchema,
} from "../training/schema";
import {
  annotationRegionSchema,
  DEFAULT_ANNOTATION_REGION,
} from "./annotation";
import { type ModelArea, modelAreaSchema } from "./area";
import { bundleProvenanceSchema } from "./bundle";
import { classesAmong, classListSchema } from "./classes";
import { inferenceSettingsSchema } from "./inference";

/**
 * How an agent annotates the task: the instructions that describe the bodies
 * to box, and the source region each look takes. Instructions belong to the
 * task the way its classes do; a run reads them, never asks for them.
 */
const modelAnnotationFields = annotationRegionSchema.extend({
  instructions: z.string().trim(),
});
const modelAnnotationSchema = modelAnnotationFields.refine(
  (v) => v.halo <= v.coreSize,
  "Context cannot exceed core size",
);

export const DEFAULT_MODEL_ANNOTATION = {
  instructions: "",
  ...DEFAULT_ANNOTATION_REGION,
} satisfies ModelAnnotation;

export const DEFAULT_MODEL_AREA = "image" satisfies ModelArea;

/**
 * A model is a task: what it looks for in an image, and where in the image
 * it looks. It exists as soon as someone asks the question, with or without
 * a version that can answer it; until one is trained, the answers are a
 * reviewer's.
 */
export const modelSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: resourceIdSchema,
    name: z.string().min(1),
    task: z.literal("object_detection"),
    classes: classListSchema,
    /**
     * The classes a day counts unless it names its own: every class, or
     * fewer where the model tells some apart only so a count can leave them
     * out.
     */
    countedClasses: classListSchema,
    area: modelAreaSchema,
    annotation: modelAnnotationSchema,
  })
  .refine((model) => classesAmong(model.countedClasses, model.classes), {
    path: ["countedClasses"],
    message: "Counted classes must be the model's, in the model's order",
  });

/**
 * What naming a new task asks for: what to call it, what it finds, where it
 * looks, and how an agent should draw it. The instructions may be added
 * later; a day counts every class unless the task counts fewer, the area
 * defaults to the whole image, and the region defaults suit the seed dishes
 * the workbench was built for.
 */
export const modelRequestSchema = z.strictObject({
  id: resourceIdSchema,
  name: z.string().min(1),
  classes: classListSchema,
  countedClasses: classListSchema.optional(),
  area: modelAreaSchema.optional(),
  annotation: modelAnnotationFields.partial().optional(),
});

/**
 * Changes which classes a day counts by default, where the task looks and
 * how an agent draws it; what it finds stays fixed. Each governs what is
 * created from now on: observations already made keep the classes they
 * count, and runs, snapshots and tasks already frozen keep their area.
 */
export const modelSettingsRequestSchema = z.strictObject({
  model: resourceIdSchema,
  countedClasses: classListSchema,
  area: modelAreaSchema,
  annotation: modelAnnotationSchema,
});

export const modelRefSchema = z.strictObject({ model: resourceIdSchema });

export const modelVersionRefSchema = z.strictObject({
  model: resourceIdSchema,
  version: resourceIdSchema,
});

const traditionalArtifactSchema = z.strictObject({
  kind: z.literal("traditional"),
  digest: sha256Schema,
});

const ultralyticsArtifactSchema = z.strictObject({
  kind: z.literal("ultralytics"),
  digest: sha256Schema,
  weights: z.strictObject({
    digest: sha256Schema,
    bytes: z.number().int().positive(),
  }),
  inference: inferenceSettingsSchema,
  validation: detectionValidationSchema,
  training: trainingRecipeSchema,
});

export const modelArtifactSchema = z.discriminatedUnion("kind", [
  traditionalArtifactSchema,
  ultralyticsArtifactSchema,
]);

/**
 * A version finds the classes it was made to find, each one of its model's
 * and in the model's order: all of them, or fewer when it was made before
 * the model declared the rest or can tell only some apart.
 */
const modelVersionIdentity = {
  schemaVersion: z.literal(1),
  id: resourceIdSchema,
  modelId: resourceIdSchema,
  classes: classListSchema,
  createdAt: timestampSchema,
};

export const modelVersionSchema = z.union([
  z.strictObject({
    ...modelVersionIdentity,
    source: z.strictObject({
      kind: z.literal("builtin"),
      definition: resourceIdSchema,
    }),
    artifact: traditionalArtifactSchema,
  }),
  z.strictObject({
    ...modelVersionIdentity,
    source: z.strictObject({
      kind: z.literal("training_run"),
      trainingRunId: resourceIdSchema,
      trainingAttempt: z.number().int().positive(),
      datasetSnapshotId: resourceIdSchema,
    }),
    artifact: ultralyticsArtifactSchema,
  }),
  z.strictObject({
    ...modelVersionIdentity,
    source: z.strictObject({
      kind: z.literal("import"),
      bundleDigest: sha256Schema,
      provenance: bundleProvenanceSchema,
    }),
    artifact: ultralyticsArtifactSchema,
  }),
]);

export type Model = z.infer<typeof modelSchema>;
export type ModelAnnotation = z.infer<typeof modelAnnotationSchema>;
export type ModelRequest = z.infer<typeof modelRequestSchema>;
export type ModelSettingsRequest = z.infer<typeof modelSettingsRequestSchema>;
export type ModelRef = z.infer<typeof modelRefSchema>;
export type ModelVersionRef = z.infer<typeof modelVersionRefSchema>;
export type ModelVersion = z.infer<typeof modelVersionSchema>;
export type ModelArtifact = z.infer<typeof modelArtifactSchema>;

export function sameModel(left: Model, right: Model): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function sameModelVersion(
  left: ModelVersion,
  right: ModelVersion,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function supportsRuntime(
  artifact: ModelArtifact,
  runtime: RuntimeDescriptor,
): boolean {
  return (
    (artifact.kind === "traditional" && runtime.adapter === "traditional") ||
    (artifact.kind === "ultralytics" && runtime.adapter === "ultralytics")
  );
}

export function validationMetric(
  artifact: ModelArtifact,
  name: "map50" | "map50To95",
): number | null {
  if (artifact.kind !== "ultralytics") return null;
  return artifact.validation[name];
}
