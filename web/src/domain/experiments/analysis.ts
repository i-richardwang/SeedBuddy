import type { UnitDay } from "./cell-reading";
import {
  type CultureEvent,
  excludingEvent,
  type ObservationOrdinals,
} from "./culture-events";
import type { Exclusion } from "./read-model";
import type { Experiment, ExperimentObservation } from "./schema";

/**
 * Why each of a unit's days stays out of the analysis, or nothing for a day
 * that enters it. Only a photograph on a day the unit's events keep in can
 * take the unit out: a dish already contaminated is out from that day on,
 * whatever is photographed later. A day an event takes out is named by the
 * event, since that is what happened to the dish.
 */
export function unitExclusions(
  events: readonly CultureEvent[],
  days: readonly UnitDay[],
  ordinals: ObservationOrdinals,
  experiment: Pick<Experiment, "countsUnclear">,
): (observation: ExperimentObservation) => Exclusion | null {
  const unclear =
    !experiment.countsUnclear &&
    days.some(
      ({ observation, image }) =>
        image?.unclear &&
        excludingEvent(events, observation, ordinals) === null,
    );
  return (observation) => {
    const event = excludingEvent(events, observation, ordinals);
    if (event) return { reason: "event", event };
    return unclear ? { reason: "unclear" } : null;
  };
}
