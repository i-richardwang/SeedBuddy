import type { UnitRef } from "../../domain/experiments/schema";
import { snapshot } from "../infra/db/client";
import { modelDatasetsDetail } from "./model-datasets-detail";
import { type UnitView, unitDetail } from "./unit-detail";

/**
 * The unit workbench: the unit's series, and the datasets the photograph in
 * view may join, or the stepping it can show instead.
 */
export function unitWorkbench(ref: UnitRef, view: UnitView) {
  return snapshot(async (db) => {
    const series = await unitDetail(ref, view, db);
    if (!series || "instead" in series) return series;
    const datasets = series.shown
      ? await modelDatasetsDetail(series.shown.model.id, db)
      : [];
    return { ...series, datasets };
  });
}
