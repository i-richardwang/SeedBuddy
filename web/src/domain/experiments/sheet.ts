import { z } from "zod";

import { unitExclusions } from "./analysis";
import {
  type ExperimentGrid,
  observationImageCellSchema,
  type ObservationImageCell,
  unitSchema,
  type Unit,
} from "./contracts";
import {
  observationOrdinals,
  type ObservationOrdinals,
} from "./culture-events";
import {
  cellReading,
  observationCells,
  READING_SOURCES,
  unitDays,
  type ObservationCells,
} from "./readings";
import {
  cultureEventSchema,
  experimentObservationSchema,
  experimentSchema,
  manualReadingSchema,
  observationIdSchema,
  treatmentSchema,
  unitIdSchema,
  type ManualReading,
} from "./schema";

/**
 * The sheet is the experiment as its numbers: every unit's cell on every
 * observation, each resolved to the reading the analysis uses and whether the
 * day is in it, over the evidence the reading came from. The spreadsheet a
 * person exports and the sheet an agent reads carry the same thing; the
 * workbench grid, which also shows what the workbench is still doing with a
 * photograph, is a different view.
 */

/** What a cell reads: the count, and who stood behind it. */
export const readingSchema = z.strictObject({
  count: z.number().int().min(0),
  source: z.enum(READING_SOURCES),
});

/** Why a cell's day stays out of the analysis. */
export const exclusionSchema = z.discriminatedUnion("reason", [
  z.strictObject({ reason: z.literal("event"), event: cultureEventSchema }),
  z.strictObject({ reason: z.literal("unclear") }),
]);

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
export const sheetCellSchema = z.strictObject({
  unit: unitIdSchema,
  observation: observationIdSchema,
  reading: readingSchema.nullable(),
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
});

export type ExperimentSheet = z.infer<typeof experimentSheetSchema>;

/** One unit's row of the sheet, with the treatment it belongs to. */
export const unitRowSchema = z.strictObject({
  experiment: experimentSchema,
  treatment: treatmentSchema,
  unit: unitSchema,
  observations: z.array(experimentObservationSchema),
  cells: z.array(sheetCellSchema),
});

export type UnitRow = z.infer<typeof unitRowSchema>;

/** The evidence a cell carries, without the cell's own address. */
function cellImage(
  image: ObservationImageCell,
): z.infer<typeof cellImageSchema> {
  const { unit: _unit, observation: _observation, ...evidence } = image;
  return evidence;
}

function cellManual(manual: ManualReading): z.infer<typeof cellManualSchema> {
  const { unit: _unit, observation: _observation, ...evidence } = manual;
  return evidence;
}

function unitCells(
  grid: ExperimentGrid,
  unit: Unit,
  cells: ObservationCells,
  ordinals: ObservationOrdinals,
): SheetCell[] {
  const days = unitDays(cells, unit.id, grid.observations);
  const exclusion = unitExclusions(
    unit.events,
    days,
    ordinals,
    grid.experiment,
  );
  return days.map((day) => ({
    unit: unit.id,
    observation: day.observation.id,
    reading: cellReading(day, day.observation),
    exclusion: exclusion(day.observation),
    image: day.image ? cellImage(day.image) : null,
    manual: day.manual ? cellManual(day.manual) : null,
  }));
}

export function experimentSheet(grid: ExperimentGrid): ExperimentSheet {
  const cells = observationCells(grid.images, grid.manualReadings);
  const ordinals = observationOrdinals(grid.observations);
  return {
    experiment: grid.experiment,
    treatments: grid.treatments,
    units: grid.units,
    observations: grid.observations,
    cells: grid.units.flatMap((unit) => unitCells(grid, unit, cells, ordinals)),
  };
}

/** The named unit's row, or nothing when the experiment has no such unit. */
export function unitRow(grid: ExperimentGrid, unitId: string): UnitRow | null {
  const unit = grid.units.find((item) => item.id === unitId);
  const treatment = grid.treatments.find((item) => item.id === unit?.treatment);
  if (!unit || !treatment) return null;
  const cells = observationCells(grid.images, grid.manualReadings);
  return {
    experiment: grid.experiment,
    treatment,
    unit,
    observations: grid.observations,
    cells: unitCells(grid, unit, cells, observationOrdinals(grid.observations)),
  };
}
