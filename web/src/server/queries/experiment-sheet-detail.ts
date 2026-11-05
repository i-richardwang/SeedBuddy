import { TreatmentNotFoundError } from "../../domain/experiments/errors";
import type {
  ExperimentSheetDetail,
  UnitPageRequest,
} from "../../domain/experiments/read-model";
import { snapshot } from "../infra/db/client";
import { experimentDesign } from "./experiment-design";
import { experimentUnitPage } from "./experiment-unit-page";

/**
 * A page of the experiment's sheet: its design, and the rows of the units on
 * the page. A treatment the experiment does not have is refused.
 */
export function experimentSheetDetail(
  experimentId: string,
  request: UnitPageRequest,
): Promise<ExperimentSheetDetail | null> {
  return snapshot(async (db) => {
    const design = await experimentDesign(experimentId, db);
    if (!design) return null;
    const units = await experimentUnitPage(design, request, db);
    if (!units) {
      throw new TreatmentNotFoundError(
        `Unknown treatment: ${request.treatment}`,
      );
    }
    return { ...design, units };
  });
}
