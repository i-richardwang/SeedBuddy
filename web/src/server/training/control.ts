import { eq } from "drizzle-orm";

import {
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../domain/training/errors";
import {
  isTrainingRunResumable,
  type TrainingControl,
  type TrainingRun,
} from "../../domain/training/schema";
import { readDataset } from "../datasets/public";
import { operationTime, transaction } from "../infra/db/client";
import { trainingRuns } from "../infra/db/schema";
import {
  activeTrainingRun,
  lockTrainingRun,
  transitionTrainingRun,
} from "./runs";
import { readDatasetSnapshot } from "./snapshots";
import { validateTrainingTarget } from "./targets";

/** Control and worker writes serialize on the task, making revocation immediate. */
export async function controlTrainingRun(
  datasetId: string,
  runId: string,
  expectedAttempt: number,
  control: TrainingControl,
): Promise<TrainingRun> {
  if (control.action === "resume")
    await validateTrainingTarget(control.targetWorkerId);
  return transaction(async (tx) => {
    const run = await lockTrainingRun(runId, tx);
    const at = await operationTime(tx);
    const dataset = await readDataset(datasetId, tx);
    const snapshot = await readDatasetSnapshot(run.datasetSnapshotId, tx);
    if (!dataset || snapshot?.datasetId !== dataset.id)
      throw new TrainingRunNotFoundError(`Training run not found: ${runId}`);
    if (run.attempt !== expectedAttempt)
      throw new TrainingRunConflictError(
        "Training changed; refresh before controlling it",
      );
    const status = run.state.status;
    if (control.action === "resume") {
      if (!isTrainingRunResumable(run))
        throw new TrainingRunConflictError(
          "Only paused or failed training can resume",
        );
      const localWorker = run.checkpoint?.workerId ?? run.targetWorkerId;
      if (
        !control.restart &&
        localWorker &&
        control.targetWorkerId &&
        control.targetWorkerId !== localWorker
      )
        throw new TrainingRunConflictError(
          "Resume requires the original worker; restart training to use another worker",
        );
      const active = await activeTrainingRun(run.modelId, tx);
      if (active)
        throw new TrainingRunConflictError(
          `Training run ${active.id} is still active for ${run.modelId}`,
        );
      await tx
        .update(trainingRuns)
        .set({
          targetWorkerId: control.restart
            ? control.targetWorkerId
            : (localWorker ?? control.targetWorkerId),
          ...(control.restart ? { checkpoint: null } : {}),
          lastProgressAt: null,
        })
        .where(eq(trainingRuns.id, runId));
      return transitionTrainingRun(runId, { status: "queued" }, at, tx);
    }
    const next = control.action === "pause" ? "paused" : "cancelled";
    if (status === next) return run;
    if (
      status === "succeeded" ||
      status === "cancelled" ||
      (next === "paused" && status === "failed")
    ) {
      throw new TrainingRunConflictError(
        `Cannot ${control.action} ${status} training`,
      );
    }
    return transitionTrainingRun(runId, { status: next }, at, tx);
  });
}
