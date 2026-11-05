import type { UnitRowOverview } from "../../domain/experiments/read-model";
import type { UnitRef } from "../../domain/experiments/schema";
import { unitRow } from "../../domain/experiments/sheet";
import { snapshot } from "../infra/db/client";
import { experimentDesign } from "./experiment-design";
import { experimentRecords } from "./experiment-records";

/** One unit's row of the sheet, read from its own records. */
export function unitRowOverview(ref: UnitRef): Promise<UnitRowOverview | null> {
  return snapshot(async (db) => {
    const design = await experimentDesign(ref.experiment, db);
    if (!design) return null;
    const records = await experimentRecords(design, db, { units: [ref.unit] });
    return unitRow(records, ref.unit);
  });
}
