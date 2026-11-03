import {
  type TrainingRun,
  trainingRunSchema,
} from "../../domain/training/schema";
import type { trainingRuns } from "../infra/db/schema";

export function toTrainingRun(
  row: typeof trainingRuns.$inferSelect,
): TrainingRun {
  const state = (() => {
    switch (row.status) {
      case "paused":
      case "cancelled":
      case "queued":
        return { status: row.status };
      case "running":
        return {
          status: row.status,
          workerId: row.workerId,
          sessionId: row.sessionId,
          leaseExpiresAt: row.leaseExpiresAt?.toISOString(),
          phase: row.phase,
          progress: row.progress,
        };
      case "succeeded":
        return { status: row.status, modelVersionId: row.modelVersionId };
      case "failed":
        return { status: row.status, error: row.error };
    }
  })();
  return trainingRunSchema.parse({
    schemaVersion: 1,
    id: row.id,
    modelId: row.modelId,
    datasetSnapshotId: row.datasetSnapshotId,
    createdAt: row.createdAt.toISOString(),
    attempt: row.attempt,
    targetWorkerId: row.targetWorkerId,
    lastProgressAt: row.lastProgressAt?.toISOString() ?? null,
    checkpoint: row.checkpoint,
    recipe: row.recipe,
    state,
  });
}
