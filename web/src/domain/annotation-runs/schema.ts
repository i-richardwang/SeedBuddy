import { z } from "zod";

import {
  annotationInstanceSchema,
  annotationRefSchema,
  annotationSchema,
  boundingBoxSchema,
  REVIEW_SOURCES,
} from "../annotation/schema";
import { sha256Schema } from "../identifiers/schema";
import { imageCoverageSchema } from "../images/coverage";
import { annotationConfigSchema } from "../models/annotation";
import { timestampSchema } from "../time";

export const ANNOTATION_RUN_STATUSES = [
  "running",
  "succeeded",
  "cancelled",
] as const;
/**
 * The boxes a run begins from: none, a complete list the caller supplies, or
 * one of the image's readings as it stands when the run starts.
 */
const annotationInputSchema = z.union([
  z.array(annotationInstanceSchema).max(10000),
  z.enum(REVIEW_SOURCES),
  z.null(),
]);

/**
 * The part of the image a run redraws, as boxes in source pixels. A run is
 * scoped to the regions those boxes touch; the regions outside keep the
 * boxes the run began from. Null redraws the whole image.
 */
const annotationScopeSchema = z
  .array(boundingBoxSchema)
  .min(1)
  .max(64)
  .nullable();

export const startAnnotationRunSchema = z.strictObject({
  ref: annotationRefSchema,
  input: annotationInputSchema.default(null),
  scope: annotationScopeSchema.default(null),
});
export type StartAnnotationRun = z.infer<typeof startAnnotationRunSchema>;
/** How many of a run's regions have been accepted. */
export const annotationProgressSchema = z
  .strictObject({
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  })
  .refine((v) => v.completed <= v.total, "Completed exceeds total");
export type AnnotationProgress = z.infer<typeof annotationProgressSchema>;

/** The boxes an agent drew as its best reading and asks a person to confirm. */
const uncertainIdsSchema = z.array(z.string().min(1));

export const annotationDefinitionSchema = z.strictObject({
  image: z.strictObject({
    digest: sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  input: z.array(annotationInstanceSchema).nullable(),
  /** Which input boxes still await confirmation, when the input is an AI proposal. */
  inputUncertainIds: uncertainIdsSchema.optional(),
  scope: annotationScopeSchema,
  config: annotationConfigSchema,
  coverage: imageCoverageSchema.nullable(),
});
export type AnnotationDefinition = z.infer<typeof annotationDefinitionSchema>;

/** Boxes and which of them await confirmation: what a region saves and what a run leaves. */
export const annotationContentSchema = z.strictObject({
  document: annotationSchema,
  uncertainIds: uncertainIdsSchema,
});
export type AnnotationContent = z.infer<typeof annotationContentSchema>;

export const annotationProposalSchema = annotationContentSchema.extend({
  createdAt: timestampSchema,
});
export type AnnotationProposal = z.infer<typeof annotationProposalSchema>;
