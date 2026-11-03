import { z } from "zod";
import { excludingEvent, type ObservationOrdinals } from "./culture-events";
import type { UnitDay } from "./readings";
import {
  cultureEventSchema,
  type CultureEvent,
  type Experiment,
  type ExperimentObservation,
} from "./schema";

/**
 * Why a unit's day stays out of the analysis. A culture event takes the unit
 * out from the observation that records it, since what came before it still
 * happened. An unclear photograph, where the experiment does not count
 * unclear photographs, takes the whole unit out: marking it says the dish's
 * record cannot be trusted, and that is said of the dish, not of one day. A
 * day with no photograph is no exclusion; the unit only has no number that
 * day.
 */
export const exclusionSchema = z.discriminatedUnion("reason", [
  z.strictObject({ reason: z.literal("event"), event: cultureEventSchema }),
  z.strictObject({ reason: z.literal("unclear") }),
]);
export type Exclusion = z.infer<typeof exclusionSchema>;

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
