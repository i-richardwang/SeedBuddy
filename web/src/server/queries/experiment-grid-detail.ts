import type { ExperimentGridDetail } from "../../domain/experiments/read-model";
import { readExperimentRecord } from "../experiments/public";
import { type Executor, inSnapshot } from "../infra/db/client";
import { readGrid } from "./experiment-grid";

export function experimentGridDetail(
  experimentId: string,
  db?: Executor,
): Promise<ExperimentGridDetail | null> {
  return inSnapshot(db, async (db) => {
    const experiment = await readExperimentRecord(experimentId, db);
    return experiment ? (await readGrid(experiment, db)).grid : null;
  });
}
