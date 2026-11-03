import { unitExclusions } from "./analysis";
import {
  cellReading,
  type ObservationCells,
  observationCells,
  unitDays,
} from "./cell-reading";
import {
  type ObservationOrdinals,
  observationOrdinals,
} from "./culture-events";
import type {
  ExperimentGridDetail,
  ExperimentSheetDetail,
  ObservationImageCell,
  SheetCell,
  Unit,
  UnitRowDetail,
} from "./read-model";
import type { ManualReading } from "./schema";
import { experimentSummary } from "./summary";

/**
 * The sheet is the experiment as its numbers: every unit's cell on every
 * observation, each resolved to the reading the analysis uses and whether the
 * day is in it, over the evidence the reading came from, and under them the
 * summary by treatment taken from those cells. The spreadsheet a person
 * exports and the sheet an agent reads carry the same thing; the workbench
 * grid, which also shows what the workbench is still doing with a photograph,
 * is a different view.
 */

/** The evidence a cell carries, without the cell's own address. */
function cellImage(
  image: ObservationImageCell,
): NonNullable<SheetCell["image"]> {
  const { unit: _unit, observation: _observation, ...evidence } = image;
  return evidence;
}

function cellManual(manual: ManualReading): NonNullable<SheetCell["manual"]> {
  const { unit: _unit, observation: _observation, ...evidence } = manual;
  return evidence;
}

function unitCells(
  grid: ExperimentGridDetail,
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

export function experimentSheet(
  grid: ExperimentGridDetail,
): ExperimentSheetDetail {
  const cells = observationCells(grid.images, grid.manualReadings);
  const ordinals = observationOrdinals(grid.observations);
  return {
    experiment: grid.experiment,
    treatments: grid.treatments,
    units: grid.units,
    observations: grid.observations,
    cells: grid.units.flatMap((unit) => unitCells(grid, unit, cells, ordinals)),
    summary: experimentSummary(grid),
  };
}

/** The named unit's row, or nothing when the experiment has no such unit. */
export function unitRow(
  grid: ExperimentGridDetail,
  unitId: string,
): UnitRowDetail | null {
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
