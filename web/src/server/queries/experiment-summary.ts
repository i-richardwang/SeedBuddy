import type {
  ExperimentDesign,
  ExperimentSummary,
} from "../../domain/experiments/read-model";
import { recordsSummary } from "../../domain/experiments/summary";
import type { Executor } from "../infra/db/client";
import { experimentRecords } from "./experiment-records";

/** The experiment summarised by treatment, read from every unit's row. */
export async function experimentSummary(
  design: ExperimentDesign,
  db: Executor,
): Promise<ExperimentSummary> {
  return recordsSummary(await experimentRecords(design, db));
}
