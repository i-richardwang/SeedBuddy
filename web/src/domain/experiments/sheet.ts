import { type AnalysisFrame, analysisFrame, unitAnalysis } from "./analysis";
import {
  type ObservationCells,
  observationCells,
  unitDays,
} from "./cell-reading";
import type {
  ExperimentRecords,
  ObservationImageCell,
  SheetCell,
  SheetRow,
  Unit,
  UnitRowOverview,
} from "./read-model";
import type { ManualReading } from "./schema";

/**
 * The sheet is the experiment as its numbers: every unit's cell on every
 * observation, each resolved to the reading the analysis uses, whether the
 * day is in it and its rate, over the evidence the reading came from, and
 * beside them what the unit's rates are taken over. A unit's row is resolved
 * from its own records alone, so any set of units, a page of them
 * or one, resolves to the same rows it has in the whole experiment; only the
 * summary by treatment reads every row. The experiment page's table of
 * units, the spreadsheet a person exports and the sheet an agent reads all
 * show these rows.
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

function unitSheetRow(
  records: ExperimentRecords,
  unit: Unit,
  cells: ObservationCells,
  frame: AnalysisFrame,
): SheetRow {
  const days = unitDays(cells, unit.id, records.observations);
  const analysis = unitAnalysis(unit, days, frame);
  return {
    unit,
    cells: days.map((day, index): SheetCell => ({
      observation: day.observation.id,
      ...analysis.days[index]!,
      image: day.image ? cellImage(day.image) : null,
      manual: day.manual ? cellManual(day.manual) : null,
    })),
    baseline: analysis.baseline,
  };
}

/** The rows of the units the records hold, in their order. */
export function sheetRows(records: ExperimentRecords): SheetRow[] {
  const cells = observationCells(records.images, records.manualReadings);
  const frame = analysisFrame(records.experiment, records.observations);
  return records.units.map((unit) => unitSheetRow(records, unit, cells, frame));
}

/** The named unit's row, or nothing when the records hold no such unit. */
export function unitRow(
  records: ExperimentRecords,
  unitId: string,
): UnitRowOverview | null {
  const unit = records.units.find((item) => item.id === unitId);
  const treatment = records.treatments.find(
    (item) => item.id === unit?.treatment,
  );
  if (!unit || !treatment) return null;
  const [row] = sheetRows({ ...records, units: [unit] });
  return {
    experiment: records.experiment,
    treatment,
    unit,
    observations: records.observations,
    cells: row!.cells,
    baseline: row!.baseline,
  };
}
