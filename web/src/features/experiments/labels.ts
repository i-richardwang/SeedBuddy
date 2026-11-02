import { m } from "../../paraglide/messages";
import { formatDay } from "../../ui/Day";
import { countedClassesName, modelName } from "../../ui/model-names";
import type {
  ExperimentObservation,
  CultureEventType,
} from "../../domain/experiments/schema";
import type { SummaryMeasure } from "../../domain/experiments/summary";
import { countsEveryClass } from "../../domain/models/classes";
import type { Model } from "../../domain/models/schema";

/** An observation is named by the day it was made. */
export function observationLabel(observation: ExperimentObservation): string {
  return formatDay(observation.observedOn);
}

/**
 * What a day asks of its photographs, said under its date: the model when
 * `nameModel`, and the classes the day counts when they are fewer than the
 * model finds. Empty when neither needs saying.
 */
export function observationQuestion(
  observation: ExperimentObservation,
  model: Model | undefined,
  { nameModel }: { nameModel: boolean },
): string {
  if (!model) return "";
  return joinFacts([
    ...(nameModel ? [modelName(model)] : []),
    ...(countsEveryClass(observation.countedClasses, model.classes)
      ? []
      : [countedClassesName(observation.countedClasses)]),
  ]);
}

/** The number a summary reads a day by, named. */
export function summaryMeasureLabel(measure: SummaryMeasure): string {
  return measure === "rate"
    ? m.summary_measure_rate()
    : m.summary_measure_count();
}

const CULTURE_EVENT_LABELS: Record<CultureEventType, () => string> = {
  contaminated: m.culture_event_contaminated,
  nonviable: m.culture_event_nonviable,
  discarded: m.culture_event_discarded,
  harvested: m.culture_event_harvested,
  missing: m.culture_event_missing,
};

export function cultureEventLabel(type: CultureEventType): string {
  return CULTURE_EVENT_LABELS[type]();
}

/** Facts of one thing, side by side in a single line. */
export function joinFacts(facts: readonly string[]): string {
  return facts.reduce(
    (first, second) =>
      first === "" ? second : m.experiment_facts_joined({ first, second }),
    "",
  );
}
