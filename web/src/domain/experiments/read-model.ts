import { z } from "zod";

import { reviewSchema } from "../annotation/readings";
import { REVIEW_SOURCES } from "../annotation/schema";
import { imageDigestSchema } from "../images/schema";
import { inferenceTaskFailureSchema } from "../inference/tasks";
import { classNameSchema, tallySchema } from "../models/classes";
import { modelSchema } from "../models/schema";
import { cultureEventSchema } from "./culture-events";
import {
  calendarDaySchema,
  DEFAULT_UNIT_PAGE_SIZE,
  experimentIdSchema,
  experimentNameSchema,
  experimentObservationSchema,
  experimentSchema,
  imageAnalysisStateSchema,
  MAX_UNIT_PAGE_SIZE,
  type ManualReading,
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
  /**
   * The observation the unit's rates are taken against where a person named
   * one, or null to take them against the experiment's first.
   */
  baseline: observationIdSchema.nullable(),
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
  /**
   * The classes of the day's model that the version which detected the
   * photograph does not find: the detection holds none of them whatever the
   * dish held. Empty where the version finds every class, and where the
   * photograph has no detection.
   */
  detectionUnfound: z.array(classNameSchema),
  proposalTally: tallySchema.nullable(),
  annotationTally: tallySchema.nullable(),
  error: z.string().nullable(),
  /** Whether a person marked the photograph unclear. */
  unclear: z.boolean(),
});

export type ObservationImageCell = z.infer<typeof observationImageCellSchema>;

/** An experiment's design: what its records are read against. */
const experimentDesignSchema = z.strictObject({
  experiment: experimentSchema,
  treatments: z.array(treatmentSchema),
  observations: z.array(experimentObservationSchema),
});

export type ExperimentDesign = z.infer<typeof experimentDesignSchema>;

/**
 * The records of an experiment's units, or of some of them: the units with
 * their culture events, and the photographs and counts entered for them,
 * under the design they are read against. Every reading and summary is
 * resolved from records; a page reads the records of the units it shows.
 */
export interface ExperimentRecords extends ExperimentDesign {
  units: Unit[];
  images: ObservationImageCell[];
  /** The counts people entered by hand, each in the cell of its unit and observation. */
  manualReadings: ManualReading[];
}

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
export type ReviewState = "reviewed" | "unreviewed";

/**
 * Where a unit stands among the units the workbench steps through: those of
 * one treatment, or all, in the experiment's order. `nextToReview` is the
 * first unit after this one, coming round from the start, whose photograph
 * of the day in view awaits review, and `toReview` counts every other such
 * unit.
 */
const unitNavigationSchema = z.strictObject({
  treatment: treatmentIdSchema.nullable(),
  position: z.number().int().min(1),
  total: z.number().int().min(1),
  previous: unitNavigationEntrySchema.nullable(),
  next: unitNavigationEntrySchema.nullable(),
  nextToReview: unitNavigationEntrySchema.nullable(),
  toReview: z.number().int().min(0),
});

export type UnitNavigation = z.infer<typeof unitNavigationSchema>;

export type UnitNavigationEntry = z.infer<typeof unitNavigationEntrySchema>;

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
  navigation: unitNavigationSchema,
  /** Whether the unit may be deleted: nothing recorded, and another replicate stays. */
  removable: z.boolean(),
  observations: z.array(unitObservationSchema),
  /** The observation in view: the one asked for, or the newest with a photograph. */
  observation: observationIdSchema.nullable(),
  shown: experimentObservationImageSchema.nullable(),
});

export type UnitDetail = z.infer<typeof unitDetailSchema>;

/**
 * What a unit's workbench came to: the unit's series, or, where the treatment
 * named is not the unit's, the stepping it can show instead: through the
 * units of the treatment named there, or through every unit for null.
 */
export type UnitDetailRead =
  UnitDetail | { instead: Pick<UnitNavigation, "treatment"> };

/** An experiment as the overview lists it: its design's size and how far its observations have come. */
export const experimentOverviewSchema = z.strictObject({
  experiment: experimentSchema,
  treatments: z.number().int().min(0),
  units: z.number().int().min(0),
  observations: z.number().int().min(0),
  lastObservedOn: calendarDaySchema.nullable(),
});

export type ExperimentOverview = z.infer<typeof experimentOverviewSchema>;

/**
 * What a unit read on a day: the individuals found, who stood behind the
 * number, and the classes of the day's model the number could not have told
 * apart, which are the ones its detecting version does not find where the
 * number is that version's, and none otherwise.
 */
const cellReadingSchema = z.strictObject({
  count: z.number().int().min(0),
  source: z.enum([...REVIEW_SOURCES, "manual"]),
  unfound: z.array(classNameSchema),
});
export type CellReading = z.infer<typeof cellReadingSchema>;

/**
 * Why a unit's day stays out of the analysis. A culture event takes the unit
 * out from the observation that records it, since what came before it still
 * happened. An unclear photograph, where the experiment does not count
 * unclear photographs, takes out the day whose number is read from it and no
 * other: what it says is that this photograph cannot be read, and a count a
 * person entered for the day stands whatever the photograph shows. A day
 * with no photograph is no exclusion; the unit only has no number that day.
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

/**
 * One treatment on one observation: `count` and `rate` summarise the
 * treatment's units in the analysis that day with that number, and are null
 * where no unit has it.
 */
const treatmentDaySummarySchema = z.strictObject({
  treatment: treatmentIdSchema,
  observation: observationIdSchema,
  count: statisticSchema.nullable(),
  rate: statisticSchema.nullable(),
});

export type TreatmentDaySummary = z.infer<typeof treatmentDaySummarySchema>;

/** Why a day gives a unit no baseline. */
const baselineGapSchema = z.enum(["unread", "unclear", "event", "model"]);

export type BaselineGap = z.infer<typeof baselineGapSchema>;

/**
 * What a day gives a unit to take its rates over: the unit's count that day
 * over the classes the first observation counts, with who stood behind it.
 * Where the day gives none, `gap` says why: nothing is read over those
 * classes (`unread`), the number would come from an unclear photograph the
 * experiment does not count (`unclear`), a culture event took the day out
 * (`event`), or the day reads for another model than the first observation
 * (`model`).
 */
const baselineDaySchema = z.strictObject({
  observation: observationIdSchema,
  count: z.number().int().min(0).nullable(),
  source: cellReadingSchema.shape.source.nullable(),
  gap: baselineGapSchema.nullable(),
});

export type BaselineDay = z.infer<typeof baselineDaySchema>;

/**
 * What a unit's rates are taken over: the day it names (`named`), or else
 * the experiment's first. `wanted` marks the baseline a rate waits on: the
 * unit has a number in the analysis on a day that takes a rate, and no
 * baseline to rate it by.
 */
const unitBaselineSchema = baselineDaySchema.extend({
  named: z.boolean(),
  wanted: z.boolean(),
});

export type UnitBaseline = z.infer<typeof unitBaselineSchema>;

export const experimentSummarySchema = z.strictObject({
  /**
   * The first observation, or null before any: what it counts is what rates
   * are taken of, and a unit's rates are taken against its own count that
   * day unless the unit names another.
   */
  first: observationIdSchema.nullable(),
  /**
   * The units whose baseline a rate waits on, in the experiment's order:
   * they have numbers in the analysis and are in no rate.
   */
  unrated: z.array(z.strictObject({ id: unitIdSchema, code: unitCodeSchema })),
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
 * `rate` is the reading over the unit's baseline, on a day that takes one.
 * The photograph and the entered count are what the reading came from.
 */
const sheetCellSchema = z.strictObject({
  observation: observationIdSchema,
  reading: cellReadingSchema.nullable(),
  exclusion: exclusionSchema.nullable(),
  rate: z.number().nullable(),
  image: cellImageSchema.nullable(),
  manual: cellManualSchema.nullable(),
});

export type SheetCell = z.infer<typeof sheetCellSchema>;

/**
 * One unit, its cell on every observation in the experiment's order, and
 * what its rates are taken over, null before any observation.
 */
const sheetRowSchema = z.strictObject({
  unit: unitSchema,
  cells: z.array(sheetCellSchema),
  baseline: unitBaselineSchema.nullable(),
});

export type SheetRow = z.infer<typeof sheetRowSchema>;

/** Which of an experiment's units a page shows: those of one treatment, or all, a page at a time. */
export const unitPageRequestSchema = z.strictObject({
  treatment: treatmentIdSchema.nullable().default(null),
  /** Counted from 1; a page past the last holds no rows. */
  page: z.number().int().min(1).default(1),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(MAX_UNIT_PAGE_SIZE)
    .default(DEFAULT_UNIT_PAGE_SIZE),
});

export type UnitPageRequest = z.infer<typeof unitPageRequestSchema>;

/**
 * A page of the experiment's rows: the units of the treatment named, or of
 * every treatment, in the experiment's order. `total` counts every unit the
 * pages are drawn from and `pages` how many pages they fill, one at least.
 */
const unitPageSchema = z.strictObject({
  rows: z.array(sheetRowSchema),
  treatment: treatmentIdSchema.nullable(),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(MAX_UNIT_PAGE_SIZE),
  pages: z.number().int().min(1),
});

export type UnitPage = z.infer<typeof unitPageSchema>;

/** The parts of an experiment's page, one on show at a time. */
export const EXPERIMENT_TABS = [
  "units",
  "summary",
  "treatments",
] as const satisfies readonly ExperimentView["tab"][];

/** What the experiment's page shows under its frame: a page of units, the summary, or the treatments. */
const experimentViewSchema = z.discriminatedUnion("tab", [
  z.strictObject({ tab: z.literal("units"), units: unitPageRequestSchema }),
  z.strictObject({ tab: z.literal("summary") }),
  z.strictObject({ tab: z.literal("treatments") }),
]);

export type ExperimentView = z.infer<typeof experimentViewSchema>;

/**
 * What a view of the experiment came to: the page of units, the summary, or
 * the treatments, which the frame already holds.
 */
export type ExperimentViewRead =
  | { tab: "units"; units: UnitPage }
  | { tab: "summary"; summary: ExperimentSummary }
  | { tab: "treatments" };

export const experimentPageRequestSchema = z.strictObject({
  experiment: experimentIdSchema,
  view: experimentViewSchema,
});

/**
 * The sheet is the experiment as its numbers, a page of units at a time:
 * the design, and each unit's cell on every observation resolved to the
 * reading the analysis uses, over the evidence it came from.
 */
export const experimentSheetSchema = experimentDesignSchema.extend({
  units: unitPageSchema,
});

export type ExperimentSheetDetail = z.infer<typeof experimentSheetSchema>;

/** A treatment as the experiment's page frames it, with how many units it holds. */
const treatmentFrameSchema = treatmentSchema.extend({
  units: z.number().int().min(0),
});

export type TreatmentFrame = z.infer<typeof treatmentFrameSchema>;

/**
 * An observation as the experiment's page frames it, with what the day
 * holds: the photographs taken that day, the units still on the bench that
 * day, and how many of those are without a photograph.
 */
const observationFrameSchema = experimentObservationSchema.extend({
  photographed: z.number().int().min(0),
  available: z.number().int().min(0),
  vacant: z.number().int().min(0),
});

export type ObservationFrame = z.infer<typeof observationFrameSchema>;

/**
 * How far the experiment's photographs have come: how many it holds and how
 * many of them still wait for their reading.
 */
const experimentProgressSchema = z.strictObject({
  photographs: z.number().int().min(0),
  waiting: z.number().int().min(0),
});

export type ExperimentProgress = z.infer<typeof experimentProgressSchema>;

/**
 * What every view of an experiment stands in: the experiment, its design
 * with the size of each part, whether anything is recorded, and how far its
 * photographs have come.
 */
const experimentFrameSchema = z.strictObject({
  experiment: experimentSchema,
  treatments: z.array(treatmentFrameSchema),
  observations: z.array(observationFrameSchema),
  hasRecords: z.boolean(),
  progress: experimentProgressSchema,
});

export type ExperimentFrame = z.infer<typeof experimentFrameSchema>;

/**
 * A unit a photograph may be placed on: its code, and the day it left the
 * bench, after which it takes none.
 */
const photoSlotSchema = z.strictObject({
  id: unitIdSchema,
  code: unitCodeSchema,
  leftOn: calendarDaySchema.nullable(),
});

export type PhotoSlot = z.infer<typeof photoSlotSchema>;

/**
 * The units a day's photographs are placed on, in the experiment's order,
 * and those the day already holds a photograph of.
 */
const photoSlotsSchema = z.strictObject({
  units: z.array(photoSlotSchema),
  taken: z.array(unitIdSchema),
});

export type PhotoSlots = z.infer<typeof photoSlotsSchema>;

/**
 * A unit on the bench on the day its counts are entered: what the day's
 * photograph of it reads, and the count already entered, if either.
 */
const manualEntryRowSchema = z.strictObject({
  unit: z.strictObject({ id: unitIdSchema, code: unitCodeSchema }),
  photographed: cellReadingSchema.nullable(),
  manual: manualReadingSchema.nullable(),
});

export type ManualEntryRow = z.infer<typeof manualEntryRowSchema>;

/** One unit's row of the sheet, with the treatment it belongs to. */
export const unitRowOverviewSchema = z.strictObject({
  experiment: experimentSchema,
  treatment: treatmentSchema,
  unit: unitSchema,
  observations: z.array(experimentObservationSchema),
  cells: z.array(sheetCellSchema),
  baseline: unitBaselineSchema.nullable(),
});

export type UnitRowOverview = z.infer<typeof unitRowOverviewSchema>;
