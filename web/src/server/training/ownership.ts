import { eq } from "drizzle-orm";

import {
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../domain/training/errors";
import type { TrainingRun } from "../../domain/training/schema";
import type { AttemptOwner } from "../../domain/workers/schema";
import { database, type Executor, operationTime } from "../infra/db/client";
import { trainingRuns } from "../infra/db/schema";
import { currentWorkerSession } from "../workers/public";
import { toTrainingRun } from "./records";
export type RunningTrainingRun = TrainingRun & {
  state: Extract<TrainingRun["state"], { status: "running" }>;
};

export function ownershipConflict(runId: string, owner: AttemptOwner) {
  return new TrainingRunConflictError(
    `Training run ${runId} is not owned by ${owner.workerId}/${owner.sessionId}`,
  );
}

export async function readTrainingRun(
  runId: string,
  db?: Executor,
): Promise<TrainingRun | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(trainingRuns)
    .where(eq(trainingRuns.id, runId));
  return row ? toTrainingRun(row) : null;
}

export async function requireTrainingRun(
  runId: string,
  db: Executor,
): Promise<TrainingRun> {
  const run = await readTrainingRun(runId, db);
  if (!run)
    throw new TrainingRunNotFoundError(`Unknown training run: ${runId}`);
  return run;
}

export async function requireOwnedRunningRun(
  run: TrainingRun,
  owner: AttemptOwner,
  db: Executor,
  suppliedAt?: Date,
): Promise<RunningTrainingRun> {
  await currentWorkerSession(owner, db);
  const at = await operationTime(db, suppliedAt);
  if (
    run.state.status !== "running" ||
    run.state.workerId !== owner.workerId ||
    run.state.sessionId !== owner.sessionId ||
    run.attempt !== owner.attempt ||
    new Date(run.state.leaseExpiresAt) <= at
  ) {
    throw ownershipConflict(run.id, owner);
  }
  return { ...run, state: run.state };
}
