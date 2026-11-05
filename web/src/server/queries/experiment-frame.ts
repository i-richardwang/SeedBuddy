import { count, eq, lt } from "drizzle-orm";

import type {
  ExperimentDesign,
  ExperimentFrame,
} from "../../domain/experiments/read-model";
import { benchExits, countUnitsByTreatment } from "../experiments/public";
import type { Executor } from "../infra/db/client";
import { experimentObservations } from "../infra/db/schema";
import { countPhotographs } from "./experiment-records";

/**
 * The experiment's frame: its design, with how many units each treatment
 * holds, and for each observation how many units were on the bench that day
 * and how many of them were photographed. Every figure is counted by the
 * database; no record is read into the frame.
 */
export async function experimentFrame(
  design: ExperimentDesign,
  db: Executor,
): Promise<ExperimentFrame> {
  const { experiment, treatments, observations } = design;
  const [sizes, photographs, left] = await Promise.all([
    countUnitsByTreatment(experiment.id, db),
    countPhotographs(experiment.id, db),
    countLeftBefore(experiment.id, db),
  ]);
  const units = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  return {
    experiment,
    treatments: treatments.map((treatment) => ({
      ...treatment,
      units: sizes.get(treatment.id) ?? 0,
    })),
    observations: observations.map((observation) => {
      const available = units - (left.get(observation.id) ?? 0);
      // A unit off the bench takes no photograph, so every photograph of
      // the day is of a unit still on it.
      const taken = photographs.byDay.get(observation.id) ?? 0;
      return {
        ...observation,
        photographed: taken,
        available,
        vacant: available - taken,
      };
    }),
    hasRecords: observations.some((observation) => observation.hasRecords),
    progress: photographs.progress,
  };
}

/** How many units had left the bench before each observation's day. */
async function countLeftBefore(
  experimentId: string,
  db: Executor,
): Promise<Map<string, number>> {
  const exits = benchExits(experimentId, db);
  const rows = await db
    .select({ observation: experimentObservations.id, left: count() })
    .from(experimentObservations)
    .innerJoin(exits, lt(exits.leftOn, experimentObservations.observedOn))
    .where(eq(experimentObservations.experimentId, experimentId))
    .groupBy(experimentObservations.id);
  return new Map(rows.map((row) => [row.observation, row.left]));
}
