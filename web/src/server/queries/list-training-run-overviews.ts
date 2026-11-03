import { desc, eq, sql } from "drizzle-orm";

import type { TrainingRunOverview } from "../../domain/training/read-model";
import { database, type Executor } from "../infra/db/client";
import {
  datasetSnapshots,
  datasets,
  trainingEpochs,
  trainingRuns,
} from "../infra/db/schema";
import { toTrainingRun } from "../training/public";

/** A workbench page stays bounded while exact totals remain separate. */
const TRAINING_RUN_LIST_LIMIT = 100;

/** The newest runs, of one training set or of every set training one model. */
export async function listTrainingRunOverviews(
  of: { datasetId: string } | { modelId: string },
  db?: Executor,
): Promise<TrainingRunOverview[]> {
  db ??= await database();
  const rows = await db
    .select({
      dataset: { id: datasets.id, name: datasets.name },
      run: trainingRuns,
      completed: sql<number>`(
        select count(*)::integer
        from ${trainingEpochs}
        where ${trainingEpochs.runId} = ${trainingRuns.id}
          and ${trainingEpochs.attempt} = ${trainingRuns.attempt}
      )`,
      bestMap50: sql<number | null>`(
        select ${trainingEpochs.map50}
        from ${trainingEpochs}
        where ${trainingEpochs.runId} = ${trainingRuns.id}
          and ${trainingEpochs.attempt} = ${trainingRuns.attempt}
        order by ${trainingEpochs.fitness} desc, ${trainingEpochs.epoch} asc
        limit 1
      )`,
      bestMap50To95: sql<number | null>`(
        select ${trainingEpochs.map50To95}
        from ${trainingEpochs}
        where ${trainingEpochs.runId} = ${trainingRuns.id}
          and ${trainingEpochs.attempt} = ${trainingRuns.attempt}
        order by ${trainingEpochs.fitness} desc, ${trainingEpochs.epoch} asc
        limit 1
      )`,
    })
    .from(trainingRuns)
    .innerJoin(
      datasetSnapshots,
      eq(datasetSnapshots.id, trainingRuns.datasetSnapshotId),
    )
    .innerJoin(datasets, eq(datasets.id, datasetSnapshots.datasetId))
    .where(
      "datasetId" in of
        ? eq(datasetSnapshots.datasetId, of.datasetId)
        : eq(datasetSnapshots.modelId, of.modelId),
    )
    .orderBy(desc(trainingRuns.createdAt), desc(trainingRuns.id))
    .limit(TRAINING_RUN_LIST_LIMIT);
  return rows.map((row) => ({
    dataset: row.dataset,
    run: toTrainingRun(row.run),
    completed: row.completed,
    best:
      row.bestMap50 == null || row.bestMap50To95 == null
        ? null
        : { map50: row.bestMap50, map50To95: row.bestMap50To95 },
  }));
}
