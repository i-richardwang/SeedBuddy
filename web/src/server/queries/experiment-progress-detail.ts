import type { ExperimentProgress } from "../../domain/experiments/read-model";
import { readExperimentRecord } from "../experiments/public";
import { snapshot } from "../infra/db/client";
import { countPhotographs } from "./experiment-records";

/**
 * How far the experiment's photographs have come, which a page showing them
 * asks while some wait, reloading only once the answer changes.
 */
export function experimentProgressDetail(
  experimentId: string,
): Promise<ExperimentProgress | null> {
  return snapshot(async (db) => {
    if (!(await readExperimentRecord(experimentId, db))) return null;
    return (await countPhotographs(experimentId, db)).progress;
  });
}
