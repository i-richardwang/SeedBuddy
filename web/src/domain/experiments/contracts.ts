import { z } from "zod";

import { reviewSchema } from "../annotation/review";
import { inferenceTaskFailureSchema } from "../inference/tasks";
import { imageDigestSchema } from "../images/schema";
import { tallySchema } from "../models/classes";
import { modelSchema } from "../models/schema";
import {
  calendarDaySchema,
  cultureEventSchema,
  experimentNameSchema,
  experimentObservationSchema,
  experimentSchema,
  imageAnalysisStateSchema,
  manualReadingSchema,
  observationIdSchema,
  observationImageIdSchema,
  observationImageRefSchema,
  treatmentIdSchema,
  treatmentSchema,
  unitCodeSchema,
  unitIdSchema,
} from "./schema";

export const unitSchema = z.strictObject({
  id: unitIdSchema,
  code: unitCodeSchema,
  treatment: treatmentIdSchema,
  events: z.array(cultureEventSchema),
});

export type Unit = z.infer<typeof unitSchema>;

const observationImageCellSchema = z.strictObject({
  id: observationImageIdSchema,
  unit: unitIdSchema,
  observation: observationIdSchema,
  digest: imageDigestSchema,
  filename: z.string(),
  state: imageAnalysisStateSchema,
  detectionTally: tallySchema.nullable(),
  proposalTally: tallySchema.nullable(),
  annotationTally: tallySchema.nullable(),
  error: z.string().nullable(),
  /** Whether a person marked the photograph unclear. */
  unclear: z.boolean(),
});

export type ObservationImageCell = z.infer<typeof observationImageCellSchema>;

export const experimentGridSchema = z.strictObject({
  experiment: experimentSchema,
  treatments: z.array(treatmentSchema),
  units: z.array(unitSchema),
  observations: z.array(experimentObservationSchema),
  images: z.array(observationImageCellSchema),
  /** The counts people entered by hand, each in the cell of its unit and observation. */
  manualReadings: z.array(manualReadingSchema),
});

export type ExperimentGrid = z.infer<typeof experimentGridSchema>;

/**
 * A unit's day: its photograph of the day, with its size so it can be framed
 * beside another, and the count a person entered for it, if either.
 */
const unitObservationSchema = z.strictObject({
  observation: experimentObservationSchema,
  image: observationImageCellSchema
    .extend({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .nullable(),
  manual: manualReadingSchema.nullable(),
});

/** A unit as the series steps through it: enough to name it and its treatment. */
const unitNavigationEntrySchema = z.strictObject({
  id: unitIdSchema,
  code: unitCodeSchema,
  treatment: treatmentIdSchema,
});

/** Whether a person has reviewed a photograph's boxes. */
const IMAGE_REVIEWS = ["reviewed", "unreviewed"] as const;

export type ImageReview = (typeof IMAGE_REVIEWS)[number];

/**
 * A unit as the series steps through it on the observation in view, with
 * whether its photograph of that day has been reviewed; a unit without one
 * that day has none.
 */
const unitStepSchema = unitNavigationEntrySchema.extend({
  image: z.enum(IMAGE_REVIEWS).nullable(),
});

export type UnitStep = z.infer<typeof unitStepSchema>;

/**
 * An observation image with its review for the observation's model, and the
 * failure to report when the version that reads for that model could not.
 */
const experimentObservationImageSchema = z.strictObject({
  ref: observationImageRefSchema,
  experimentName: experimentNameSchema,
  unit: unitNavigationEntrySchema,
  observation: experimentObservationSchema,
  model: modelSchema,
  review: reviewSchema,
  failure: inferenceTaskFailureSchema.nullable(),
  unclear: z.boolean(),
});

export type ExperimentObservationImage = z.infer<
  typeof experimentObservationImageSchema
>;

export const unitSeriesSchema = z.strictObject({
  experiment: experimentSchema,
  unit: unitSchema,
  treatments: z.array(treatmentSchema),
  navigation: z.array(unitStepSchema),
  observations: z.array(unitObservationSchema),
  /** The observation in view: the one asked for, or the newest with a photograph. */
  observation: observationIdSchema.nullable(),
  shown: experimentObservationImageSchema.nullable(),
});

export type UnitSeries = z.infer<typeof unitSeriesSchema>;

/** An experiment as the overview lists it: its design's size and how far its observations have come. */
export const experimentSummarySchema = z.strictObject({
  experiment: experimentSchema,
  treatments: z.number().int().min(0),
  units: z.number().int().min(0),
  observations: z.number().int().min(0),
  lastObservedOn: calendarDaySchema.nullable(),
});

export type ExperimentSummary = z.infer<typeof experimentSummarySchema>;
