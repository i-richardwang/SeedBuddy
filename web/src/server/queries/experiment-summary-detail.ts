import type { ExperimentSummary } from "../../domain/experiments/read-model";
import { snapshot } from "../infra/db/client";
import { experimentDesign } from "./experiment-design";
import { experimentSummary } from "./experiment-summary";

/** The experiment summarised by treatment on every observation. */
export function experimentSummaryDetail(
  experimentId: string,
): Promise<ExperimentSummary | null> {
  return snapshot(async (db) => {
    const design = await experimentDesign(experimentId, db);
    return design ? experimentSummary(design, db) : null;
  });
}
