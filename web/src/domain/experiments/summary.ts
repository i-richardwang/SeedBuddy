import { firstObservation } from "./analysis";
import type {
  ExperimentRecords,
  ExperimentSummary,
  Statistic,
  TreatmentDaySummary,
} from "./read-model";
import { sheetRows } from "./sheet";

/**
 * The summary is the experiment by treatment: on each observation, how many
 * of a treatment's units have a number in the analysis, the mean of those
 * numbers, and how far they spread. The unit is the replicate, so the
 * statistics are taken over units, never over the individuals they hold.
 *
 * Two numbers are summarised, both as the unit's row holds them. The count
 * is what the unit read that day. The rate is that count over what the
 * unit's rates are taken over: its own count on the first observation, the
 * day everything sown was counted, unless the unit names another. A
 * germination trial's rate is the seeds germinated over the seeds sown in
 * the same dish.
 */

/** A treatment's summary on an observation, or none for a pair the summary does not hold. */
export function summaryCell(
  summary: ExperimentSummary,
  treatment: string,
  observation: string,
): TreatmentDaySummary | undefined {
  return summary.cells.find(
    (cell) => cell.treatment === treatment && cell.observation === observation,
  );
}

/** Which of a day's two numbers is the one to read. */
export type SummaryMeasure = "count" | "rate";

/**
 * The number a day is read by: its rate, where any treatment has one that
 * day, else its count. The first observation and a day read for another
 * model have counts alone.
 */
export function summaryMeasure(
  summary: ExperimentSummary,
  observation: string,
): SummaryMeasure {
  return summary.cells.some(
    (cell) => cell.observation === observation && cell.rate !== null,
  )
    ? "rate"
    : "count";
}

/** The sample statistics of `values`, or nothing for none. */
export function statistic(values: readonly number[]): Statistic | null {
  const n = values.length;
  if (n === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  if (n === 1) return { n, mean, sd: null, se: null };
  const squares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const sd = Math.sqrt(squares / (n - 1));
  return { n, mean, sd, se: sd / Math.sqrt(n) };
}

/** The treatment's units on the observation, keyed as the summary gathers them. */
function summaryKey(treatment: string, observation: string): string {
  return `${treatment}:${observation}`;
}

/**
 * The experiment summarised by treatment on every observation, from the row
 * of every unit the records hold as the analysis reads it.
 */
export function recordsSummary(records: ExperimentRecords): ExperimentSummary {
  // Every unit's numbers on every day, before they are gathered by treatment.
  const numbers = new Map<string, { count: number; rate: number | null }[]>();
  const unrated: ExperimentSummary["unrated"] = [];
  for (const { unit, cells, baseline } of sheetRows(records)) {
    if (baseline?.wanted) unrated.push({ id: unit.id, code: unit.code });
    for (const cell of cells) {
      if (cell.exclusion || !cell.reading) continue;
      const key = summaryKey(unit.treatment, cell.observation);
      const entry = numbers.get(key) ?? [];
      entry.push({ count: cell.reading.count, rate: cell.rate });
      numbers.set(key, entry);
    }
  }

  return {
    first: firstObservation(records.observations)?.id ?? null,
    unrated,
    cells: records.treatments.flatMap((treatment) =>
      records.observations.map((observation): TreatmentDaySummary => {
        const units =
          numbers.get(summaryKey(treatment.id, observation.id)) ?? [];
        return {
          treatment: treatment.id,
          observation: observation.id,
          count: statistic(units.map((unit) => unit.count)),
          rate: statistic(
            units.flatMap((unit) => (unit.rate === null ? [] : [unit.rate])),
          ),
        };
      }),
    ),
  };
}
