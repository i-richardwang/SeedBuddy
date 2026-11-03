import { parseDate } from "@internationalized/date";

import {
  type Exclusion,
  unitExclusions,
} from "../../domain/experiments/analysis";
import type { ExperimentGrid, Unit } from "../../domain/experiments/contracts";
import {
  type ObservationOrdinals,
  observationOrdinals,
} from "../../domain/experiments/culture-events";
import {
  type ObservationCells,
  observationCells,
  unitDays,
  unitReading,
} from "../../domain/experiments/readings";
import {
  type CalendarDay,
  type Experiment,
  type ExperimentObservation,
  formatFactor,
  type Treatment,
} from "../../domain/experiments/schema";
import {
  type ExperimentSummary,
  experimentSummary,
  type Statistic,
  type SummaryMeasure,
  summaryCell,
  summaryMeasure,
} from "../../domain/experiments/summary";
import type { Model } from "../../domain/models/schema";
import {
  blankCell,
  type CellStyle,
  countCell,
  dateCell,
  decimalCell,
  ratioCell,
  sheetName,
  textCell,
  type Workbook,
  type WorkbookCell,
  type WorkbookSheet,
  workbookFilename,
} from "../../lib/spreadsheet/workbook";
import { m } from "../../paraglide/messages";
import { formatDay } from "../../ui/Day";
import {
  cultureEventLabel,
  observationQuestion,
  summaryMeasureLabel,
} from "./labels";

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

/** The summary's design columns: a treatment and its factor. */
const SUMMARY_DESIGN_COLUMNS = [{ width: 22 }, { width: 16 }];
/** A day of the summary: its date over its measure over n, mean, SD and SE. */
const SUMMARY_HEADING_ROWS = 3;
const SUMMARY_DAY_COLUMNS = [
  { width: 6 },
  { width: 10 },
  { width: 10 },
  { width: 10 },
];
/** A mean count is written to one decimal. */
const COUNT_DIGITS = 1;

export function experimentWorkbookFilename(experiment: Experiment): string {
  return workbookFilename(experiment.name, m.experiments_title());
}

/**
 * The experiment as a file of two sheets: the grid, and the summary of it by
 * treatment.
 */
export function experimentWorkbook(
  source: ExperimentWorkbookSource,
  exportedOn: CalendarDay,
): Workbook {
  return {
    sheets: [gridSheet(source, exportedOn), summarySheet(source, exportedOn)],
  };
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
export function gridSheet(
  source: ExperimentWorkbookSource,
  exportedOn: CalendarDay,
): WorkbookSheet {
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
    name: sheetName(experiment.name, m.experiments_title()),
    columns: [...DESIGN_COLUMNS, ...days.map(() => ({ width: DAY_WIDTH }))],
    rows,
    stickyRows,
    stickyColumns: DESIGN_COLUMNS.length,
  };
}

/**
 * The summary as a spreadsheet: a row per treatment, and under each day its
 * n, mean, standard deviation and standard error over the treatment's units
 * in the analysis that day. A day is summarised by its rate, each unit's
 * count over its own count on the first observation, where any treatment has
 * one, and by its count otherwise; the row under the date says which. Notes
 * under the table say how the numbers were taken.
 */
export function summarySheet(
  source: ExperimentWorkbookSource,
  exportedOn: CalendarDay,
): WorkbookSheet {
  const { experiment, treatments, observations } = source;
  const summary = experimentSummary(source);
  const baseline = observations.find(
    (observation) => observation.id === summary.baseline,
  );
  const measures = observations.map((observation) =>
    summaryMeasure(summary, observation.id),
  );
  const rows: WorkbookCell[][] = [
    [textCell(experiment.name, { strong: true })],
    ...provenance(experiment, exportedOn),
    [],
  ];
  const stickyRows = rows.length + SUMMARY_HEADING_ROWS;
  rows.push(...summaryHeading(observations, measures));
  for (const treatment of treatments) {
    rows.push(summaryRow(treatment, observations, summary));
  }
  rows.push([], [textCell(m.summary_note_statistics())]);
  if (baseline) {
    rows.push([
      textCell(m.summary_note_rate({ day: formatDay(baseline.observedOn) })),
    ]);
  }

  return {
    name: sheetName(m.experiment_summary(), m.experiment_summary()),
    columns: [
      ...SUMMARY_DESIGN_COLUMNS,
      ...observations.flatMap(() => SUMMARY_DAY_COLUMNS),
    ],
    rows,
    stickyRows,
    stickyColumns: SUMMARY_DESIGN_COLUMNS.length,
  };
}

/** The three heading rows: the dates, each over its measure, over n, mean, SD and SE. */
function summaryHeading(
  observations: readonly ExperimentObservation[],
  measures: readonly SummaryMeasure[],
): WorkbookCell[][] {
  const covering = { strong: true, rows: SUMMARY_HEADING_ROWS };
  const spanning = { strong: true, columns: SUMMARY_DAY_COLUMNS.length };
  const design = SUMMARY_DESIGN_COLUMNS.map(() => blankCell);
  const perDay = (cells: WorkbookCell[]) => observations.flatMap(() => cells);
  return [
    [
      textCell(m.experiment_column_treatment(), covering),
      textCell(m.workbook_column_factor(), covering),
      ...observations.flatMap((observation) => [
        calendarCell(observation.observedOn, spanning),
        ...SUMMARY_DAY_COLUMNS.slice(1).map(() => blankCell),
      ]),
    ],
    [
      ...design,
      ...measures.flatMap((measure) => [
        textCell(summaryMeasureLabel(measure), spanning),
        ...SUMMARY_DAY_COLUMNS.slice(1).map(() => blankCell),
      ]),
    ],
    [
      ...design,
      ...perDay([
        textCell(m.summary_column_n(), { strong: true }),
        textCell(m.summary_column_mean(), { strong: true }),
        textCell(m.summary_column_sd(), { strong: true }),
        textCell(m.summary_column_se(), { strong: true }),
      ]),
    ],
  ];
}

/** A treatment's row: its name and factor, then its statistics under each day. */
function summaryRow(
  treatment: Treatment,
  observations: readonly ExperimentObservation[],
  summary: ExperimentSummary,
): WorkbookCell[] {
  return [
    textCell(treatment.name),
    factorCell(treatment),
    ...observations.flatMap((observation) => {
      const cell = summaryCell(summary, treatment.id, observation.id);
      const measure = summaryMeasure(summary, observation.id);
      const statistic = measure === "rate" ? cell?.rate : cell?.count;
      return statisticCells(statistic ?? null, measure);
    }),
  ];
}

/** n, mean, SD and SE, the spread left blank where a single unit has none. */
function statisticCells(
  statistic: Statistic | null,
  measure: SummaryMeasure,
): WorkbookCell[] {
  if (!statistic) return SUMMARY_DAY_COLUMNS.map(() => blankCell);
  const value = (figure: number | null) =>
    figure === null
      ? blankCell
      : measure === "rate"
        ? ratioCell(figure)
        : decimalCell(figure, COUNT_DIGITS);
  return [
    countCell(statistic.n),
    value(statistic.mean),
    value(statistic.sd),
    value(statistic.se),
  ];
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
