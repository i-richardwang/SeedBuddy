import { snapshot } from "../infra/db/client";
import {
  listTrainingEpochs,
  requireSnapshot,
  requireTrainingRun,
} from "../training/public";

/** The run, its source dataset and epoch history from one committed snapshot. */
export function agentTrainingRunDetail(runId: string) {
  return snapshot(async (db) => {
    const run = await requireTrainingRun(runId, db);
    const frozen = await requireSnapshot(run.datasetSnapshotId, db);
    return {
      run,
      datasetId: frozen.datasetId,
      epochs: await listTrainingEpochs(runId, db),
    };
  });
}
