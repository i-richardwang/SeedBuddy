import { parseDate } from "@internationalized/date";

import {
  blankCell,
  countCell,
  dateCell,
  sheetName,
  textCell,
  workbookFilename,
  type CellStyle,
  type Workbook,
  type WorkbookCell,
} from "../../lib/spreadsheet/workbook";
import {
  unitExclusions,
  type Exclusion,
} from "../../domain/experiments/analysis";
import type { ExperimentGrid, Unit } from "../../domain/experiments/contracts";
import {
  observationOrdinals,
  type ObservationOrdinals,
} from "../../domain/experiments/culture-events";
import {
  observationCells,
  unitDays,
  unitReading,
  type ObservationCells,
} from "../../domain/experiments/readings";
import {
  formatFactor,
  type CalendarDay,
  type Experiment,
  type ExperimentObservation,
  type Treatment,
} from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import { cultureEventLabel, observationQuestion } from "./labels";
import { m } from "../../paraglide/messages";

export type ExperimentWorkbookSource = ExperimentGrid & {
  models: readonly Model[];
};

interface Day {
  observation: ExperimentObservation;
  model: Model | undefined;
}

const DESIGN_COLUMNS = [{ width: 22 }, { width: 16 }, { width: 14 }];
const HEADING_ROWS = 2;
const DAY_WIDTH = 14;

export function experimentWorkbookFilename(experiment: Experiment): string {
  return workbookFilename(experiment.name, m.experiments_title());
}

/**
 * The grid as a spreadsheet: a row per unit with its design repeated, the
 * days across the top, and every count left as a number for whatever charts or
 * computes on it. A count is a count whoever stood behind it, read from the
 * photograph or entered by hand.
 *
 * The sheet records what the dish did rather than what the workbench is doing.
 * A reading still waiting, or one that failed, leaves its cell empty; a unit an
 * event took out of the analysis is named by that event in place of its count,
 * and a unit with a photograph found unclear, where the experiment does not
 * count such photographs, says so in place of every count it has.
 */
export function experimentWorkbook(
  source: ExperimentWorkbookSource,
  exportedOn: CalendarDay,
): Workbook {
  const {
    experiment,
    treatments,
    units,
    observations,
    images,
    manualReadings,
    models,
  } = source;
  const cells = observationCells(images, manualReadings);
  const ordinals = observationOrdinals(observations);
  const days = observations.map((observation): Day => ({
    observation,
    model: models.find((model) => model.id === observation.modelId),
  }));

  const rows: WorkbookCell[][] = [
    [textCell(experiment.name, { strong: true })],
    ...provenance(experiment, exportedOn),
    [],
  ];
  const stickyRows = rows.length + HEADING_ROWS;
  rows.push(...heading(days));
  for (const treatment of treatments) {
    for (const unit of units.filter(
      (item) => item.treatment === treatment.id,
    )) {
      rows.push(unitRow(experiment, treatment, unit, days, cells, ordinals));
    }
  }

  return {
    sheet: sheetName(experiment.name, m.experiments_title()),
    columns: [...DESIGN_COLUMNS, ...days.map(() => ({ width: DAY_WIDTH }))],
    rows,
    stickyRows,
    stickyColumns: DESIGN_COLUMNS.length,
  };
}

function calendarCell(day: CalendarDay, style?: CellStyle): WorkbookCell {
  return dateCell(parseDate(day), style);
}

function fieldCell(value: string): WorkbookCell {
  return value.length > 0 ? textCell(value) : blankCell;
}

function provenance(
  experiment: Experiment,
  exportedOn: CalendarDay,
): WorkbookCell[][] {
  const fields: [label: string, value: WorkbookCell][] = [
    [m.experiment_field_plant_material(), fieldCell(experiment.plantMaterial)],
    [m.experiment_field_explant_type(), fieldCell(experiment.explantType)],
    [m.experiment_field_base_medium(), fieldCell(experiment.baseMedium)],
    [m.experiment_field_inoculated(), calendarCell(experiment.inoculatedOn)],
    [m.workbook_exported(), calendarCell(exportedOn)],
  ];
  return fields
    .filter(([, value]) => value.kind !== "blank")
    .map(([label, value]) => [textCell(label, { strong: true }), value]);
}

function heading(days: readonly Day[]): WorkbookCell[][] {
  const covering = { strong: true, rows: HEADING_ROWS };
  return [
    [
      textCell(m.experiment_column_treatment(), covering),
      textCell(m.workbook_column_factor(), covering),
      textCell(m.experiment_column_unit(), covering),
      ...days.map((day) =>
        calendarCell(day.observation.observedOn, { strong: true }),
      ),
    ],
    [
      ...DESIGN_COLUMNS.map(() => blankCell),
      // A file outlives its workbench, so a day names the model it was read
      // for, and the classes it counts when they are fewer than the model finds.
      ...days.map((day) =>
        fieldCell(
          observationQuestion(day.observation, day.model, { nameModel: true }),
        ),
      ),
    ],
  ];
}

function factorCell(treatment: Treatment): WorkbookCell {
  return treatment.factor
    ? textCell(formatFactor(treatment.factor))
    : blankCell;
}

function unitRow(
  experiment: Experiment,
  treatment: Treatment,
  unit: Unit,
  days: readonly Day[],
  cells: ObservationCells,
  ordinals: ObservationOrdinals,
): WorkbookCell[] {
  const exclusion = unitExclusions(
    unit.events,
    unitDays(
      cells,
      unit.id,
      days.map((day) => day.observation),
    ),
    ordinals,
    experiment,
  );
  return [
    textCell(treatment.name),
    factorCell(treatment),
    textCell(unit.code),
    ...days.map((day) =>
      unitCell(unit, day, cells, exclusion(day.observation)),
    ),
  ];
}

function unitCell(
  unit: Unit,
  day: Day,
  cells: ObservationCells,
  exclusion: Exclusion | null,
): WorkbookCell {
  if (exclusion) return textCell(exclusionLabel(exclusion));
  const reading = unitReading(cells, unit.id, day.observation);
  return reading ? countCell(reading.count) : blankCell;
}

function exclusionLabel(exclusion: Exclusion): string {
  return exclusion.reason === "event"
    ? cultureEventLabel(exclusion.event.type)
    : m.unclear_label();
}
