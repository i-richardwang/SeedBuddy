import type { ExperimentDesign } from "../../domain/experiments/read-model";
import {
  listObservations,
  listTreatments,
  readExperimentRecord,
} from "../experiments/public";
import type { Executor } from "../infra/db/client";

/** The experiment's design, which every view of it is read against; nothing for an unknown experiment. */
export async function experimentDesign(
  experimentId: string,
  db: Executor,
): Promise<ExperimentDesign | null> {
  const experiment = await readExperimentRecord(experimentId, db);
  if (!experiment) return null;
  const [treatments, observations] = await Promise.all([
    listTreatments(experimentId, db),
    listObservations(experimentId, db),
  ]);
  return { experiment, treatments, observations };
}
