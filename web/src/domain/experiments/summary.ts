import { unitExclusions } from "./analysis";
import {
  cellKey,
  cellReading,
  observationCells,
  unitDays,
} from "./cell-reading";
import { observationOrdinals } from "./culture-events";
import type {
  ExperimentGridDetail,
  ExperimentSummary,
  Statistic,
  TreatmentDaySummary,
} from "./read-model";
import type { ExperimentObservation } from "./schema";

/**
 * The summary is the experiment by treatment: on each observation, how many
 * of a treatment's units have a number in the analysis, the mean of those
 * numbers, and how far they spread. The unit is the replicate, so the
 * statistics are taken over units, never over the individuals they hold.
 *
 * Two numbers are summarised. The count is what the unit read that day. The
 * rate is that count over the unit's own count on the first observation, the
 * day everything sown was counted: a germination trial's rate is the seeds
 * germinated over the seeds sown in the same dish. A rate exists only where
 * the day reads for the model the first observation read for, and the unit
 * counted something that first day; the first observation itself has none.
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

/** The observation rates are taken against: the first one made. */
function baselineObservation(
  observations: readonly ExperimentObservation[],
): ExperimentObservation | null {
  return observations.reduce<ExperimentObservation | null>(
    (first, observation) =>
      first === null || observation.ordinal < first.ordinal
        ? observation
        : first,
    null,
  );
}

/** The treatment's units on the observation, keyed as the summary gathers them. */
function summaryKey(treatment: string, observation: string): string {
  return `${treatment}:${observation}`;
}

/** The experiment summarised by treatment on every observation, from the cells the analysis reads. */
export function experimentSummary(
  grid: ExperimentGridDetail,
): ExperimentSummary {
  const cells = observationCells(grid.images, grid.manualReadings);
  const ordinals = observationOrdinals(grid.observations);
  const baseline = baselineObservation(grid.observations);

  // Every unit's numbers on every day, before they are gathered by treatment.
  const numbers = new Map<string, TreatmentDaySummary["units"]>();
  for (const unit of grid.units) {
    const days = unitDays(cells, unit.id, grid.observations);
    const exclusion = unitExclusions(
      unit.events,
      days,
      ordinals,
      grid.experiment,
    );
    const first = baseline
      ? cellReading(cells.get(cellKey(unit.id, baseline.id)), baseline)
      : null;
    for (const day of days) {
      if (exclusion(day.observation)) continue;
      const reading = cellReading(day, day.observation);
      if (!reading) continue;
      const comparable =
        baseline !== null &&
        day.observation.id !== baseline.id &&
        day.observation.modelId === baseline.modelId &&
        first !== null &&
        first.count > 0;
      const key = summaryKey(unit.treatment, day.observation.id);
      const entry = numbers.get(key) ?? [];
      entry.push({
        unit: unit.id,
        count: reading.count,
        rate: comparable ? reading.count / first.count : null,
      });
      numbers.set(key, entry);
    }
  }

  return {
    baseline: baseline?.id ?? null,
    cells: grid.treatments.flatMap((treatment) =>
      grid.observations.map((observation): TreatmentDaySummary => {
        const units =
          numbers.get(summaryKey(treatment.id, observation.id)) ?? [];
        return {
          treatment: treatment.id,
          observation: observation.id,
          units,
          count: statistic(units.map((unit) => unit.count)),
          rate: statistic(
            units.flatMap((unit) => (unit.rate === null ? [] : [unit.rate])),
          ),
        };
      }),
    ),
  };
}
