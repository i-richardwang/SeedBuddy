import type {
  ExperimentDesign,
  UnitPage,
  UnitPageRequest,
} from "../../domain/experiments/read-model";
import { sheetRows } from "../../domain/experiments/sheet";
import { countUnits } from "../experiments/public";
import type { Executor } from "../infra/db/client";
import { experimentRecords } from "./experiment-records";

/**
 * A page of the experiment's rows, cut by the database from its units in
 * the experiment's order: only the units on the page are read. A page past
 * the last holds no rows; the caller decides what to show instead. Nothing
 * for a treatment the design does not have.
 */
export async function experimentUnitPage(
  design: ExperimentDesign,
  { treatment, page, pageSize }: UnitPageRequest,
  db: Executor,
): Promise<UnitPage | null> {
  if (
    treatment !== null &&
    !design.treatments.some((item) => item.id === treatment)
  ) {
    return null;
  }
  const scope = treatment === null ? "all" : { treatment };
  const [total, records] = await Promise.all([
    countUnits(design.experiment.id, db, scope),
    experimentRecords(design, db, scope, {
      offset: (page - 1) * pageSize,
      limit: pageSize,
    }),
  ]);
  return {
    rows: sheetRows(records),
    treatment,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
