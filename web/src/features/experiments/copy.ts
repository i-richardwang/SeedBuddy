import type { ExperimentObservation } from "../../domain/experiments/schema";
import { countsEveryClass } from "../../domain/models/classes";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { countedClassesLabel, modelName } from "../../ui/model-names";

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
      : [countedClassesLabel(observation.countedClasses)]),
  ]);
}

/** Facts of one thing, side by side in a single line. */
export function joinFacts(facts: readonly string[]): string {
  return facts.reduce(
    (first, second) =>
      first === "" ? second : m.experiment_facts_joined({ first, second }),
    "",
  );
}
