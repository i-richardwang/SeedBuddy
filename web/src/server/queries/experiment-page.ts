import { unitPageShown } from "../../domain/experiments/paging";
import type {
  ExperimentDesign,
  ExperimentView,
  ExperimentViewRead,
  UnitPageRequest,
} from "../../domain/experiments/read-model";
import { type Executor, snapshot } from "../infra/db/client";
import { listModels } from "../models/public";
import { experimentDesign } from "./experiment-design";
import { experimentFrame } from "./experiment-frame";
import { experimentSummary } from "./experiment-summary";
import { experimentUnitPage } from "./experiment-unit-page";

/**
 * The experiment's page: its frame, the models an observation may be read
 * for, and what the view on show comes to; no other view is read. A page
 * of units it cannot show names the nearest page it can instead.
 */
export function experimentPage(experimentId: string, view: ExperimentView) {
  return snapshot(async (db) => {
    const design = await experimentDesign(experimentId, db);
    if (!design) return null;
    // The frame is read beside the view rather than after it: a page the
    // address cannot show is rare, and waiting on the view would hold up
    // every page that can be.
    const [frame, models, shown] = await Promise.all([
      experimentFrame(design, db),
      listModels(db),
      readView(design, view, db),
    ]);
    return "instead" in shown ? shown : { frame, models, view: shown };
  });
}

async function readView(
  design: ExperimentDesign,
  view: ExperimentView,
  db: Executor,
): Promise<ExperimentViewRead | { instead: UnitPageRequest }> {
  switch (view.tab) {
    case "units": {
      const shown = unitPageShown(
        view.units,
        await experimentUnitPage(design, view.units, db),
      );
      return "instead" in shown ? shown : { tab: "units", units: shown.page };
    }
    case "summary":
      return { tab: "summary", summary: await experimentSummary(design, db) };
    case "treatments":
      return { tab: "treatments" };
  }
}
