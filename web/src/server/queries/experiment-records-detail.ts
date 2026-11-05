import type { ExperimentRecords } from "../../domain/experiments/read-model";
import { snapshot } from "../infra/db/client";
import { experimentDesign } from "./experiment-design";
import { experimentRecords } from "./experiment-records";

/** Every record of the experiment, as a whole-experiment export reads it. */
export function experimentRecordsDetail(
  experimentId: string,
): Promise<ExperimentRecords | null> {
  return snapshot(async (db) => {
    const design = await experimentDesign(experimentId, db);
    return design ? experimentRecords(design, db) : null;
  });
}
