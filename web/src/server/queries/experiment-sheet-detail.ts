import type { ExperimentSheetDetail } from "../../domain/experiments/read-model";
import { experimentSheet } from "../../domain/experiments/sheet";
import { readExperimentRecord } from "../experiments/public";
import { snapshot } from "../infra/db/client";
import { readGrid } from "./experiment-grid";

export function experimentSheetDetail(
  experimentId: string,
): Promise<ExperimentSheetDetail | null> {
  return snapshot(async (db) => {
    const experiment = await readExperimentRecord(experimentId, db);
    return experiment
      ? experimentSheet((await readGrid(experiment, db)).grid)
      : null;
  });
}
