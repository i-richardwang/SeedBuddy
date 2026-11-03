import type { UnitRef } from "../../domain/experiments/schema";
import { listDatasetsForModel } from "../datasets/public";
import { snapshot } from "../infra/db/client";
import { unitDetail } from "./unit-detail";

export function unitPage(ref: UnitRef, observation?: string) {
  return snapshot(async (db) => {
    const series = await unitDetail(ref, observation, db);
    if (!series) return null;
    const datasets = series.shown
      ? (await listDatasetsForModel(series.shown.model.id, db)).map(
          ({ id, name }) => ({ id, name }),
        )
      : [];
    return { ...series, datasets };
  });
}
