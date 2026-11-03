import { z } from "zod";

import { reviewSchema } from "../annotation/readings";
import { REVIEW_SOURCES } from "../annotation/schema";
import type { Dataset } from "../datasets/schema";
import { imageDigestSchema } from "../images/schema";
import { inferenceTaskFailureSchema } from "../inference/tasks";
import { tallySchema } from "../models/classes";
import type { Model } from "../models/schema";
import { modelSchema } from "../models/schema";
import { cultureEventSchema } from "./culture-events";
import {
  calendarDaySchema,
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

const experimentGridSchema = z.strictObject({
  experiment: experimentSchema,
  treatments: z.array(treatmentSchema),
  units: z.array(unitSchema),
  observations: z.array(experimentObservationSchema),
  images: z.array(observationImageCellSchema),
  /** The counts people entered by hand, each in the cell of its unit and observation. */
  manualReadings: z.array(manualReadingSchema),
});

export type ExperimentGridDetail = z.infer<typeof experimentGridSchema>;

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

export type ReviewState = (typeof IMAGE_REVIEWS)[number];

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

export type ExperimentObservationImageDetail = z.infer<
  typeof experimentObservationImageSchema
>;

const unitDetailSchema = z.strictObject({
  experiment: experimentSchema,
  unit: unitSchema,
  treatments: z.array(treatmentSchema),
  navigation: z.array(unitStepSchema),
  observations: z.array(unitObservationSchema),
  /** The observation in view: the one asked for, or the newest with a photograph. */
  observation: observationIdSchema.nullable(),
  shown: experimentObservationImageSchema.nullable(),
});

export type UnitDetail = z.infer<typeof unitDetailSchema>;

/** An experiment as the overview lists it: its design's size and how far its observations have come. */
export const experimentOverviewSchema = z.strictObject({
  experiment: experimentSchema,
  treatments: z.number().int().min(0),
  units: z.number().int().min(0),
  observations: z.number().int().min(0),
  lastObservedOn: calendarDaySchema.nullable(),
});

export type ExperimentOverview = z.infer<typeof experimentOverviewSchema>;

export interface ExperimentDetail extends ExperimentGridDetail {
  models: Model[];
  datasets: Dataset[];
}

/** What a unit read on a day: the individuals found, and who stood behind the number. */
const cellReadingSchema = z.strictObject({
  count: z.number().int().min(0),
  source: z.enum([...REVIEW_SOURCES, "manual"]),
});
export type CellReading = z.infer<typeof cellReadingSchema>;

/**
 * Why a unit's day stays out of the analysis. A culture event takes the unit
 * out from the observation that records it, since what came before it still
 * happened. An unclear photograph, where the experiment does not count
 * unclear photographs, takes the whole unit out: marking it says the dish's
 * record cannot be trusted, and that is said of the dish, not of one day. A
 * day with no photograph is no exclusion; the unit only has no number that
 * day.
 */
const exclusionSchema = z.discriminatedUnion("reason", [
  z.strictObject({ reason: z.literal("event"), event: cultureEventSchema }),
  z.strictObject({ reason: z.literal("unclear") }),
]);
export type Exclusion = z.infer<typeof exclusionSchema>;

/** How the numbers of a treatment's units fall: how many, their mean, and their spread. */
const statisticSchema = z.strictObject({
  n: z.number().int().min(1),
  mean: z.number(),
  /** The sample standard deviation, or null for a single unit, which has no spread. */
  sd: z.number().nullable(),
  /** The standard error of the mean, sd over the root of n; null with sd. */
  se: z.number().nullable(),
});

export type Statistic = z.infer<typeof statisticSchema>;

/** One unit's numbers on a day, as the summary takes them. */
const summaryUnitSchema = z.strictObject({
  unit: unitIdSchema,
  count: z.number().int().min(0),
  rate: z.number().nullable(),
});

/**
 * One treatment on one observation. `units` are the treatment's units in the
 * analysis that day with a number; `count` and `rate` summarise them, and
 * are null where no unit has that number.
 */
const treatmentDaySummarySchema = z.strictObject({
  treatment: treatmentIdSchema,
  observation: observationIdSchema,
  units: z.array(summaryUnitSchema),
  count: statisticSchema.nullable(),
  rate: statisticSchema.nullable(),
});

export type TreatmentDaySummary = z.infer<typeof treatmentDaySummarySchema>;

const experimentSummarySchema = z.strictObject({
  /** The observation rates are taken against: the first, or null before any. */
  baseline: observationIdSchema.nullable(),
  /** A summary for every treatment on every observation, treatments in the design's order. */
  cells: z.array(treatmentDaySummarySchema),
});

export type ExperimentSummary = z.infer<typeof experimentSummarySchema>;

/** The cell's photograph, named so datasets and marks can find it. */
const cellImageSchema = observationImageCellSchema.omit({
  unit: true,
  observation: true,
});

/** The cell's count entered by hand. */
const cellManualSchema = manualReadingSchema.omit({
  unit: true,
  observation: true,
});

/**
 * One unit on one observation. `reading` is what the analysis counts and
 * `exclusion` why it would not; both are null for a day with nothing yet.
 * The photograph and the entered count are what the reading came from.
 */
const sheetCellSchema = z.strictObject({
  unit: unitIdSchema,
  observation: observationIdSchema,
  reading: cellReadingSchema.nullable(),
  exclusion: exclusionSchema.nullable(),
  image: cellImageSchema.nullable(),
  manual: cellManualSchema.nullable(),
});

export type SheetCell = z.infer<typeof sheetCellSchema>;

export const experimentSheetSchema = z.strictObject({
  experiment: experimentSchema,
  treatments: z.array(treatmentSchema),
  units: z.array(unitSchema),
  observations: z.array(experimentObservationSchema),
  /** A cell for every unit on every observation, units in the grid's order. */
  cells: z.array(sheetCellSchema),
  /** The cells summarised by treatment on each observation. */
  summary: experimentSummarySchema,
});

export type ExperimentSheetDetail = z.infer<typeof experimentSheetSchema>;

/** One unit's row of the sheet, with the treatment it belongs to. */
export const unitRowOverviewSchema = z.strictObject({
  experiment: experimentSchema,
  treatment: treatmentSchema,
  unit: unitSchema,
  observations: z.array(experimentObservationSchema),
  cells: z.array(sheetCellSchema),
});

export type UnitRowOverview = z.infer<typeof unitRowOverviewSchema>;
