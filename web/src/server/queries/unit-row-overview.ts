import type { UnitRowOverview } from "../../domain/experiments/read-model";
import type { UnitRef } from "../../domain/experiments/schema";
import { unitRow } from "../../domain/experiments/sheet";
import { readExperimentRecord } from "../experiments/public";
import { snapshot } from "../infra/db/client";
import { readGrid } from "./experiment-grid";

export function unitRowOverview(ref: UnitRef): Promise<UnitRowOverview | null> {
  return snapshot(async (db) => {
    const experiment = await readExperimentRecord(ref.experiment, db);
    return experiment
      ? unitRow((await readGrid(experiment, db)).grid, ref.unit)
      : null;
  });
}
