import { z } from "zod";

import { annotationSchema } from "../annotation/schema";
import { resourceIdSchema, sha256Schema } from "../identifiers/schema";
import { imageCoverageSchema } from "../images/coverage";
import { imageDigestSchema } from "../images/schema";
import { modelAreaSchema } from "../models/area";
import { classListSchema } from "../models/classes";
import { timestampSchema } from "../time";
import { trainingParametersSchema } from "./parameters";

/** A snapshot needs one training and one validation image. */
export const MIN_SNAPSHOT_IMAGES = 2;

export const IMAGE_SPLITS = ["train", "val"] as const;
export type ImageSplit = (typeof IMAGE_SPLITS)[number];

export const TRAINING_PHASES = ["preparing", "training", "validating"] as const;
export type TrainingPhase = (typeof TRAINING_PHASES)[number];

export const TRAINING_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "paused",
  "cancelled",
] as const;
export const ACTIVE_TRAINING_RUN_STATUSES = ["queued", "running"] as const;
const ACTIVE_TRAINING_RUN_STATUS_SET = new Set<string>(
  ACTIVE_TRAINING_RUN_STATUSES,
);
const RESUMABLE_TRAINING_RUN_STATUS_SET = new Set<string>(["paused", "failed"]);

/**
 * One image a snapshot trains on, with the dish coverage it is framed to:
 * the annotation's boxes stay in canonical pixels, and the Worker crops
 * pixels and boxes alike to the covered dish. Null frames the whole image,
 * which is every image of an `image` snapshot and, with its reason logged,
 * an image of a `dish` snapshot whose analysis found no dish.
 */
const snapshotImageSchema = z
  .strictObject({
    digest: imageDigestSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    split: z.enum(IMAGE_SPLITS),
    coverage: imageCoverageSchema.nullable(),
    annotation: annotationSchema,
  })
  .superRefine((image, context) => {
    if (image.annotation.image.digest !== image.digest) {
      context.addIssue({
        code: "custom",
        path: ["annotation", "image", "digest"],
        message: "Snapshot annotation describes another image",
      });
    }
    if (
      image.annotation.image.width !== image.width ||
      image.annotation.image.height !== image.height
    ) {
      context.addIssue({
        code: "custom",
        path: ["annotation", "image"],
        message: "Snapshot annotation dimensions differ from its image",
      });
    }
  });

export const datasetSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: resourceIdSchema,
    datasetId: resourceIdSchema,
    modelId: resourceIdSchema,
    classes: classListSchema,
    /** The model's area when the snapshot froze; the mode its version reads in. */
    area: modelAreaSchema,
    createdAt: timestampSchema,
    images: z.array(snapshotImageSchema).min(MIN_SNAPSHOT_IMAGES),
  })
  .superRefine((snapshot, context) => {
    const known = new Set(snapshot.classes);
    snapshot.images.forEach((image, imageIndex) => {
      image.annotation.instances.forEach((instance, instanceIndex) => {
        if (known.has(instance.class)) return;
        context.addIssue({
          code: "custom",
          path: [
            "images",
            imageIndex,
            "annotation",
            "instances",
            instanceIndex,
            "class",
          ],
          message: `Snapshot annotation uses unknown class ${instance.class}`,
        });
      });
    });
  });

export const trainingRecipeSchema = z.strictObject({
  baseModel: z.strictObject({
    reference: z.string().min(1),
    digest: sha256Schema,
  }),
  parameters: trainingParametersSchema,
  runtime: z.strictObject({
    framework: z.literal("ultralytics"),
    version: z.string().min(1),
  }),
});

const lossSchema = z.strictObject({
  box: z.number().finite(),
  classification: z.number().finite(),
  regression: z.number().finite(),
});

const unit = z.number().finite().min(0).max(1);

export const detectionValidationSchema = z.strictObject({
  precision: unit,
  recall: unit,
  map50: unit,
  map50To95: unit,
  fitness: z.number().finite(),
});

export const trainingEpochReportSchema = z.strictObject({
  epoch: z.number().int().positive(),
  train: lossSchema,
  val: lossSchema,
  precision: unit,
  recall: unit,
  map50: unit,
  map50To95: unit,
  fitness: z.number().finite(),
  learningRate: z.number().finite().nonnegative(),
});

export const trainingEpochSchema = trainingEpochReportSchema.extend({
  recordedAt: timestampSchema,
});

const trainingRunStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("queued") }),
  z.strictObject({ status: z.literal("paused") }),
  z.strictObject({ status: z.literal("cancelled") }),
  z.strictObject({
    status: z.literal("running"),
    workerId: resourceIdSchema,
    sessionId: resourceIdSchema,
    leaseExpiresAt: timestampSchema,
    phase: z.enum(TRAINING_PHASES),
    progress: z.number().finite().min(0).max(1),
  }),
  z.strictObject({
    status: z.literal("succeeded"),
    modelVersionId: resourceIdSchema,
  }),
  z.strictObject({
    status: z.literal("failed"),
    error: z.string().min(1).max(2000),
  }),
]);

/** Last reported recovery point; its files exist only on this Worker. */
const trainingCheckpointSchema = z.strictObject({
  attempt: z.number().int().positive(),
  epoch: z.number().int().positive(),
  workerId: resourceIdSchema,
});
export type TrainingCheckpoint = z.infer<typeof trainingCheckpointSchema>;

export const trainingControlSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("pause") }),
  z.strictObject({ action: z.literal("cancel") }),
  z.strictObject({
    action: z.literal("resume"),
    targetWorkerId: resourceIdSchema.nullable(),
    restart: z.boolean(),
  }),
]);
export type TrainingControl = z.infer<typeof trainingControlSchema>;

export const TRAINING_ATTEMPT_OUTCOMES = [
  "succeeded",
  "failed",
  "paused",
  "cancelled",
  "expired",
] as const;

export interface TrainingAttempt {
  attempt: number;
  workerId: string;
  startedAt: z.infer<typeof timestampSchema>;
  finishedAt: z.infer<typeof timestampSchema> | null;
  outcome: (typeof TRAINING_ATTEMPT_OUTCOMES)[number] | null;
  error: string | null;
}

export const trainingRunSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: resourceIdSchema,
  modelId: resourceIdSchema,
  datasetSnapshotId: resourceIdSchema,
  createdAt: timestampSchema,
  attempt: z.number().int().nonnegative(),
  targetWorkerId: resourceIdSchema.nullable(),
  lastProgressAt: timestampSchema.nullable(),
  checkpoint: trainingCheckpointSchema.nullable(),
  recipe: trainingRecipeSchema,
  state: trainingRunStateSchema,
});

export type DatasetSnapshot = z.infer<typeof datasetSnapshotSchema>;
export type TrainingRecipe = z.infer<typeof trainingRecipeSchema>;
export type TrainingRun = z.infer<typeof trainingRunSchema>;
export type TrainingEpochReport = z.infer<typeof trainingEpochReportSchema>;
export type TrainingEpoch = z.infer<typeof trainingEpochSchema>;

export function isTrainingRunActive(run: Pick<TrainingRun, "state">): boolean {
  return ACTIVE_TRAINING_RUN_STATUS_SET.has(run.state.status);
}

/** A paused or failed run can be continued. */
export function isTrainingRunResumable(
  run: Pick<TrainingRun, "state">,
): boolean {
  return RESUMABLE_TRAINING_RUN_STATUS_SET.has(run.state.status);
}

const TRAINING_RUN_ID_PREFIX = "train-";

export function trainingRunId(uuid: string): string {
  return `${TRAINING_RUN_ID_PREFIX}${uuid}`;
}
