import type { NamedDataset } from "../../domain/datasets/schema";
import { listDatasetsForModel } from "../datasets/public";
import { type Executor, inSnapshot } from "../infra/db/client";

/** The datasets that train the model, by name: those its photographs may join. */
export function modelDatasetsDetail(
  modelId: string,
  db?: Executor,
): Promise<NamedDataset[]> {
  return inSnapshot(db, async (db) =>
    (await listDatasetsForModel(modelId, db)).map(({ id, name }) => ({
      id,
      name,
    })),
  );
}
