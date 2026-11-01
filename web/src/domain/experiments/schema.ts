import { z } from "zod";

import { resourceIdSchema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";
import { classListSchema, tallySchema } from "../models/classes";

export const experimentIdSchema = z.uuid();
export const observationIdSchema = z.uuid();
export const treatmentIdSchema = z.uuid();
export const unitIdSchema = z.uuid();
export const observationImageIdSchema = z.uuid();

/** A calendar day in the notebook, without a clock or a time zone. */
function calendarParts(day: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === date
    ? [year, month, date]
    : null;
}

export const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
  .refine((day) => calendarParts(day) !== null, "Invalid date");

export type CalendarDay = z.infer<typeof calendarDaySchema>;

/** Today on the calendar of the machine that asks. */
export function today(): CalendarDay {
  const now = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const experimentNameSchema = z
  .string()
  .trim()
  .min(1, "Experiment name is required")
  .max(120, "Experiment name must be at most 120 characters");

const plantMaterialSchema = z
  .string()
  .trim()
  .max(120, "Plant material must be at most 120 characters");

const explantTypeSchema = z
  .string()
  .trim()
  .max(120, "Explant type must be at most 120 characters");

const baseMediumSchema = z
  .string()
  .trim()
  .max(200, "Base medium must be at most 200 characters");

const experimentNotesSchema = z
  .string()
  .trim()
  .max(2000, "Notes must be at most 2000 characters");

export const treatmentNameSchema = z
  .string()
  .trim()
  .min(1, "Treatment name is required")
  .max(120, "Treatment name must be at most 120 characters");

const treatmentNoteSchema = z
  .string()
  .trim()
  .max(1000, "Treatment note must be at most 1000 characters");

const treatmentFactorSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, "Factor name is required")
    .max(60, "Factor name must be at most 60 characters"),
  level: z
    .string()
    .trim()
    .min(1, "Factor level is required")
    .max(60, "Factor level must be at most 60 characters"),
  unit: z.string().trim().max(20, "Unit must be at most 20 characters"),
});

export type TreatmentFactor = z.infer<typeof treatmentFactorSchema>;

export function formatFactor(factor: TreatmentFactor | null): string {
  if (!factor) return "";
  return `${factor.name} ${factor.level}${factor.unit ? ` ${factor.unit}` : ""}`.trim();
}

export const unitCodeSchema = z
  .string()
  .trim()
  .min(1, "Unit code is required")
  .max(60, "Unit code must be at most 60 characters");

const observationNoteSchema = z
  .string()
  .trim()
  .max(500, "Observation note must be at most 500 characters");

export const CULTURE_EVENT_TYPES = [
  "contaminated",
  "nonviable",
  "discarded",
  "harvested",
  "missing",
] as const;

export type CultureEventType = (typeof CULTURE_EVENT_TYPES)[number];

const cultureEventTypeSchema = z.enum(CULTURE_EVENT_TYPES);

export const experimentSchema = z.strictObject({
  id: experimentIdSchema,
  name: experimentNameSchema,
  plantMaterial: plantMaterialSchema,
  explantType: explantTypeSchema,
  baseMedium: baseMediumSchema,
  notes: experimentNotesSchema,
  inoculatedOn: calendarDaySchema,
  /**
   * Whether a unit with a photograph marked unclear stays in the analysis.
   * Unless it does, the unit is out of it on every day.
   */
  countsUnclear: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
});

export type Experiment = z.infer<typeof experimentSchema>;

const replicateCountSchema = z
  .number()
  .int()
  .min(1, "A treatment needs at least one replicate")
  .max(200, "A treatment can have at most 200 replicates");

const treatmentDesignSchema = z.strictObject({
  name: treatmentNameSchema,
  factor: treatmentFactorSchema.nullable().default(null),
  note: treatmentNoteSchema.default(""),
  replicates: replicateCountSchema,
});

export type TreatmentDesign = z.infer<typeof treatmentDesignSchema>;
export type TreatmentDesignInput = z.input<typeof treatmentDesignSchema>;

function distinctNames(items: readonly { name: string }[]): boolean {
  const names = items.map((item) => item.name.toLowerCase());
  return new Set(names).size === names.length;
}

function distinctIds(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

export const experimentRequestSchema = z.strictObject({
  name: experimentNameSchema,
  plantMaterial: plantMaterialSchema.default(""),
  explantType: explantTypeSchema.default(""),
  baseMedium: baseMediumSchema.default(""),
  notes: experimentNotesSchema.default(""),
  inoculatedOn: calendarDaySchema,
  countsUnclear: z.boolean().default(false),
  treatments: z
    .array(treatmentDesignSchema)
    .min(1, "An experiment needs at least one treatment")
    .max(50, "An experiment can have at most 50 treatments")
    .refine(distinctNames, "Two treatments cannot share a name"),
});

export type ExperimentRequest = z.infer<typeof experimentRequestSchema>;
export type ExperimentRequestInput = z.input<typeof experimentRequestSchema>;

export const experimentUpdateSchema = z.strictObject({
  experiment: experimentIdSchema,
  name: experimentNameSchema,
  plantMaterial: plantMaterialSchema,
  explantType: explantTypeSchema,
  baseMedium: baseMediumSchema,
  notes: experimentNotesSchema,
  inoculatedOn: calendarDaySchema,
  countsUnclear: z.boolean(),
});

export type ExperimentUpdate = z.infer<typeof experimentUpdateSchema>;

export const experimentRefSchema = z.strictObject({
  experiment: experimentIdSchema,
});

export type ExperimentRef = z.infer<typeof experimentRefSchema>;

export const treatmentSchema = z.strictObject({
  id: treatmentIdSchema,
  name: treatmentNameSchema,
  factor: treatmentFactorSchema.nullable(),
  note: treatmentNoteSchema,
  position: z.number().int().min(1),
});

export type Treatment = z.infer<typeof treatmentSchema>;

export const treatmentRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  treatment: treatmentIdSchema,
});

export type TreatmentRef = z.infer<typeof treatmentRefSchema>;

export const treatmentRequestSchema = treatmentDesignSchema.extend({
  experiment: experimentIdSchema,
});

export type TreatmentRequest = z.infer<typeof treatmentRequestSchema>;

export const replicateRequestSchema = treatmentRefSchema.extend({
  replicates: replicateCountSchema,
});

export type ReplicateRequest = z.infer<typeof replicateRequestSchema>;

export const treatmentUpdateSchema = treatmentRefSchema.extend({
  name: treatmentNameSchema,
  factor: treatmentFactorSchema.nullable(),
  note: treatmentNoteSchema,
});

export type TreatmentUpdate = z.infer<typeof treatmentUpdateSchema>;

export const unitRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  unit: unitIdSchema,
});

export type UnitRef = z.infer<typeof unitRefSchema>;

export const unitRequestSchema = unitRefSchema.extend({
  observation: observationIdSchema.optional(),
});

export const unitUpdateSchema = unitRefSchema.extend({
  code: unitCodeSchema,
  treatment: treatmentIdSchema,
});

export type UnitUpdate = z.infer<typeof unitUpdateSchema>;

export const unitsTreatmentUpdateSchema = z.strictObject({
  experiment: experimentIdSchema,
  units: z
    .array(unitIdSchema)
    .min(1)
    .max(200)
    .refine(distinctIds, "Units must be distinct"),
  treatment: treatmentIdSchema,
});

export type UnitsTreatmentUpdate = z.infer<typeof unitsTreatmentUpdateSchema>;

const cultureEventIdSchema = z.uuid();

export const cultureEventSchema = z.strictObject({
  id: cultureEventIdSchema,
  type: cultureEventTypeSchema,
  observation: observationIdSchema,
  recordedAt: z.string().datetime({ offset: true }),
});

export type CultureEvent = z.infer<typeof cultureEventSchema>;

export const cultureEventRequestSchema = unitRefSchema.extend({
  type: cultureEventTypeSchema,
  observation: observationIdSchema,
});

export type CultureEventRequest = z.infer<typeof cultureEventRequestSchema>;

export const cultureEventsRequestSchema = z.strictObject({
  experiment: experimentIdSchema,
  units: z
    .array(unitIdSchema)
    .min(1)
    .max(200)
    .refine(distinctIds, "Units must be distinct"),
  type: cultureEventTypeSchema,
  observation: observationIdSchema,
});

export type CultureEventsRequest = z.infer<typeof cultureEventsRequestSchema>;

export const cultureEventRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  event: cultureEventIdSchema,
});

export type CultureEventRef = z.infer<typeof cultureEventRefSchema>;

/**
 * A count a person entered for a unit on a day: what they counted at the
 * bench, such as at transplanting, whether or not the dish was photographed.
 * It is kept by class, like the tally a photograph yields, so the day counts
 * it over the classes it names and a change of those recounts it. A person's
 * number outranks every reading of the day's photograph.
 */
export const manualReadingSchema = z.strictObject({
  unit: unitIdSchema,
  observation: observationIdSchema,
  tally: tallySchema,
  recordedAt: z.string().datetime({ offset: true }),
});

export type ManualReading = z.infer<typeof manualReadingSchema>;

/** A unit's count entered by hand, or `null` to withdraw the one it has. */
const manualReadingEntrySchema = z.strictObject({
  unit: unitIdSchema,
  tally: tallySchema.nullable(),
});

export type ManualReadingEntry = z.infer<typeof manualReadingEntrySchema>;

/**
 * The counts entered for several units on one observation, in one step: as
 * many as the observation has units, each at most once.
 */
export const manualReadingsRequestSchema = z.strictObject({
  experiment: experimentIdSchema,
  observation: observationIdSchema,
  readings: z
    .array(manualReadingEntrySchema)
    .min(1, "No counts to record")
    .refine(
      (entries) => distinctIds(entries.map((entry) => entry.unit)),
      "Units must be distinct",
    ),
});

export type ManualReadingsRequest = z.infer<typeof manualReadingsRequestSchema>;

/**
 * An observation is one day the units were photographed, and the question
 * asked of them: the model its images are read for, and which of that model's
 * classes the day counts. Which version answers is the workbench's business,
 * and until one is trained the answer is a reviewer's own.
 */
export const experimentObservationSchema = z.strictObject({
  id: observationIdSchema,
  ordinal: z.number().int().min(1),
  observedOn: calendarDaySchema,
  note: observationNoteSchema,
  modelId: resourceIdSchema,
  /** Some of the model's classes, in the order the model declares them. */
  countedClasses: classListSchema,
  hasRecords: z.boolean(),
});

export type ExperimentObservation = z.infer<typeof experimentObservationSchema>;

export const observationRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  observation: observationIdSchema,
});

export type ObservationRef = z.infer<typeof observationRefSchema>;

export const observationRequestSchema = z.strictObject({
  experiment: experimentIdSchema,
  observedOn: calendarDaySchema,
  note: observationNoteSchema.default(""),
  modelId: resourceIdSchema,
  /** Every class the model recognizes, unless the day counts fewer. */
  countedClasses: classListSchema.optional(),
});

export type ObservationRequest = z.infer<typeof observationRequestSchema>;

export const observationUpdateSchema = observationRefSchema.extend({
  observedOn: calendarDaySchema,
  note: observationNoteSchema,
  modelId: resourceIdSchema,
  countedClasses: classListSchema,
});

export type ObservationUpdate = z.infer<typeof observationUpdateSchema>;

export const observationImageRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  observationImage: observationImageIdSchema,
});

export type ObservationImageRef = z.infer<typeof observationImageRefSchema>;

/** The source filename is retained for traceability and is not an identifier. */
const imageFilenameSchema = z
  .string()
  .min(1, "Invalid image filename")
  .max(255, "Invalid image filename")
  .refine(
    (filename) =>
      filename !== "." && filename !== ".." && !/[\\/\0]/.test(filename),
    "Invalid image filename",
  );

/**
 * A stored photograph and the unit it shows. `unclear` marks it unclear in the
 * same step, when the person who took it already knows; it never clears a
 * mark the photograph has.
 */
const unitPhotoSchema = z.strictObject({
  unit: unitIdSchema,
  digest: imageDigestSchema,
  filename: imageFilenameSchema,
  unclear: z.boolean().optional(),
});

export type UnitPhoto = z.infer<typeof unitPhotoSchema>;

export const observationImageAssignmentSchema = z.strictObject({
  experiment: experimentIdSchema,
  observation: observationIdSchema,
  images: z.array(unitPhotoSchema).min(1, "No images to assign"),
});

/**
 * A new observation day with the photographs taken on it, each matched to its
 * unit; a day may be planned before any are taken.
 */
export const observationRecordSchema = observationRequestSchema.extend({
  images: z.array(unitPhotoSchema).default([]),
});

export type ObservationRecord = z.infer<typeof observationRecordSchema>;

export type ObservationImageAssignment = z.infer<
  typeof observationImageAssignmentSchema
>;

export const observationImageAssignmentResultSchema = z.strictObject({
  observation: experimentObservationSchema,
  assigned: z.number().int().min(0),
});

export type ObservationImageAssignmentResult = z.infer<
  typeof observationImageAssignmentResultSchema
>;

/**
 * How far the workbench itself has got with an observation image. A model with
 * no version yet leaves its images unread: nothing is queued, nothing failed,
 * and the count is whatever a reviewer draws.
 */
const IMAGE_ANALYSIS_STATES = [
  "unread",
  "pending",
  "failed",
  "analyzed",
  "proposed",
] as const;

export const imageAnalysisStateSchema = z.enum(IMAGE_ANALYSIS_STATES);

export type ImageAnalysisState = z.infer<typeof imageAnalysisStateSchema>;
