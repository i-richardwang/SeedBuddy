import type { ModelCatalogueEntry } from "../../domain/models/contracts";
import { snapshot } from "../infra/db/client";
import { models } from "../infra/db/schema";
import { modelRecordCounts, toModel, toModelRecords } from "../models/public";

/**
 * Every task the workbench recognizes, with what has accumulated against it: a
 * task nothing has recorded yet can still be withdrawn.
 */
export function modelCatalogue(): Promise<ModelCatalogueEntry[]> {
  return snapshot(async (db) => {
    const rows = await db
      .select({ model: models, ...modelRecordCounts(db, models.id) })
      .from(models)
      .orderBy(models.id);
    return rows.map((row) => ({
      model: toModel(row.model),
      records: toModelRecords(row),
    }));
  });
}
