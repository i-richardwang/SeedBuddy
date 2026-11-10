import { cellReading, type EvidenceDay } from "./cell-reading";
import {
  type CultureEvent,
  excludingEvent,
  type ObservationOrdinals,
  observationOrdinals,
} from "./culture-events";
import type {
  BaselineDay,
  BaselineGap,
  CellReading,
  Exclusion,
  UnitBaseline,
} from "./read-model";
import type { Experiment, ExperimentObservation } from "./schema";

/**
 * The analysis answers three questions of a unit, each on its own. What a
 * day's number is and whether it can be used is asked of the cell, the unit
 * on that day. Whether the unit is still in the experiment is asked of its
 * culture events, from a day on. What its rates are taken over is asked of
 * the unit, once. `unitAnalysis` puts the three answers together, and the
 * sheet, the summary and every view read that and nothing under it.
 */

/** What every unit's days are read against. */
export interface AnalysisFrame {
  ordinals: ObservationOrdinals;
  experiment: Pick<Experiment, "countsUnclear">;
}

/** The frame the experiment's units are read against. */
export function analysisFrame(
  experiment: AnalysisFrame["experiment"],
  observations: readonly ExperimentObservation[],
): AnalysisFrame {
  return { ordinals: observationOrdinals(observations), experiment };
}

/** A unit's day as the analysis reads it: its number, and why the number stays out. */
export interface DayAnalysis {
  reading: CellReading | null;
  exclusion: Exclusion | null;
}

/** A unit's day with its rate, where the day has one. */
export interface RatedDay extends DayAnalysis {
  rate: number | null;
}

/** A unit as the analysis reads it: its days in their order, and what its rates are taken over. */
export interface UnitAnalysis {
  days: RatedDay[];
  /** Null before any observation. */
  baseline: UnitBaseline | null;
}

/** The experiment's first observation, or nothing before any. */
export function firstObservation(
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

/**
 * A unit's day read over the classes `counting` counts, the day's own unless
 * told otherwise. A day an event takes out is named by the event, since that
 * is what happened to the dish. An unclear photograph, where the experiment
 * does not count such photographs, takes out the number read from it: a
 * count a person entered stands, and so does every other day.
 */
export function dayAnalysis(
  events: readonly CultureEvent[],
  day: EvidenceDay,
  { ordinals, experiment }: AnalysisFrame,
  counting: Pick<ExperimentObservation, "countedClasses"> = day.observation,
): DayAnalysis {
  const reading = cellReading(day, counting);
  const event = excludingEvent(events, day.observation, ordinals);
  if (event) return { reading, exclusion: { reason: "event", event } };
  const unclear =
    !experiment.countsUnclear &&
    day.image?.unclear === true &&
    reading?.source !== "manual";
  return { reading, exclusion: unclear ? { reason: "unclear" } : null };
}

/**
 * What a day gives a unit to take its rates over: its count over the classes
 * the first observation counts, which are what a rate is taken of. A tally
 * keeps every class whatever its day counts, so a later day can stand in for
 * a first one that gave no number, where a person judges that it still shows
 * every individual. The day gives none where it reads for another model than
 * the first, is out of the analysis, or has nothing read, and says which.
 */
function dayBaseline(
  events: readonly CultureEvent[],
  day: EvidenceDay,
  first: ExperimentObservation,
  frame: AnalysisFrame,
): BaselineDay {
  const { reading, exclusion } = dayAnalysis(events, day, frame, first);
  const gap: BaselineGap | null =
    day.observation.modelId !== first.modelId
      ? "model"
      : (exclusion?.reason ?? (reading ? null : "unread"));
  return {
    observation: day.observation.id,
    count: gap === null ? reading!.count : null,
    source: gap === null ? reading!.source : null,
    gap,
  };
}

/**
 * What each of a unit's days would give it to take its rates over, by
 * observation: what a person choosing among them chooses on.
 */
export function baselineDays(
  events: readonly CultureEvent[],
  days: readonly EvidenceDay[],
  frame: AnalysisFrame,
): Map<string, BaselineDay> {
  const first = firstObservation(days.map((day) => day.observation));
  return new Map(
    first
      ? days.map((day) => [
          day.observation.id,
          dayBaseline(events, day, first, frame),
        ])
      : [],
  );
}

/**
 * A unit's days and what its rates are taken over: its count on the
 * observation it names, or else on the experiment's first. A day takes a rate
 * where its number is in the analysis and it is neither the first
 * observation, whose count is what the others are taken of, nor read for
 * another model. Its rate is its count over the baseline; where the baseline
 * counted nothing, the day has none and the baseline is wanted.
 */
export function unitAnalysis(
  unit: { events: readonly CultureEvent[]; baseline: string | null },
  days: readonly EvidenceDay[],
  frame: AnalysisFrame,
): UnitAnalysis {
  const first = firstObservation(days.map((day) => day.observation));
  if (!first) return { days: [], baseline: null };
  const named = days.find(
    ({ observation }) => observation.id === (unit.baseline ?? first.id),
  );
  if (!named) throw new Error(`Unknown observation: ${unit.baseline}`);
  const over = dayBaseline(unit.events, named, first, frame);
  const analysed = days.map((day) => {
    const analysis = dayAnalysis(unit.events, day, frame);
    const rated =
      analysis.reading !== null &&
      analysis.exclusion === null &&
      day.observation.id !== first.id &&
      day.observation.modelId === first.modelId;
    return { analysis, rated };
  });
  return {
    days: analysed.map(({ analysis, rated }) => ({
      ...analysis,
      rate: rated && over.count ? analysis.reading!.count / over.count : null,
    })),
    baseline: {
      ...over,
      named: unit.baseline !== null,
      wanted: !over.count && analysed.some(({ rated }) => rated),
    },
  };
}
