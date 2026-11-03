import { listDatasets } from "../datasets/public";
import { snapshot } from "../infra/db/client";
import { listModels } from "../models/public";
import { experimentGridDetail } from "./experiment-grid-detail";

export function experimentGridPage(experiment: string) {
  return snapshot(async (db) => {
    const grid = await experimentGridDetail(experiment, db);
    if (!grid) return null;
    const [models, datasets] = await Promise.all([
      listModels(db),
      listDatasets(db),
    ]);
    return { ...grid, models, datasets };
  });
}
