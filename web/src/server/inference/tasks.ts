import { and, asc, eq, gt, not, sql } from "drizzle-orm";

import type { InferenceTarget } from "../../domain/inference/assignments";
import { InferenceAttemptConflictError } from "../../domain/inference/errors";
import type { InferenceFailure } from "../../domain/inference/tasks";
import { inferenceTaskSchema } from "../../domain/inference/tasks";
import {
  type Executor,
  inTransaction,
  operationTime,
  snapshot,
  transaction,
} from "../infra/db/client";
import { inferenceAttempts, inferenceTasks } from "../infra/db/schema";
import { leaseIsHeld } from "../workers/public";
import { materializeInferenceDemand } from "./demand";
import { INFERENCE_MAX_ATTEMPTS, retryDelaySeconds } from "./policy";

export type Task = typeof inferenceTasks.$inferSelect;
export type Attempt = typeof inferenceAttempts.$inferSelect;

export function taskKey(target: InferenceTarget) {
  return and(
    eq(inferenceTasks.imageId, target.digest),
    eq(inferenceTasks.modelVersionId, target.versionId),
  );
}
export function attemptKey(target: InferenceTarget, attempt: number) {
  return and(
    eq(inferenceAttempts.imageId, target.digest),
    eq(inferenceAttempts.modelVersionId, target.versionId),
    eq(inferenceAttempts.attempt, attempt),
  );
}
export function attemptIsActive(at: Date) {
  return sql`(${eq(inferenceAttempts.status, "running")} and ${leaseIsHeld(inferenceAttempts, at)} and ${gt(inferenceAttempts.deadlineAt, at)})`;
}
export async function lockInferenceTask(
  target: InferenceTarget,
  db: Executor,
): Promise<Task> {
  const [task] = await db
    .select()
    .from(inferenceTasks)
    .where(taskKey(target))
    .for("update");
  if (!task)
    throw new InferenceAttemptConflictError("Inference task does not exist");
  return task;
}

/** Finish one attempt and retain its history; a failure is not a model result. */
export async function finishFailedAttempt(
  task: Task,
  attempt: Attempt,
  failure: InferenceFailure,
  at: Date,
  db: Executor,
): Promise<void> {
  const target = { digest: task.imageId, versionId: task.modelVersionId };
  await db
    .update(inferenceAttempts)
    .set({ status: "failed", finishedAt: at, failure })
    .where(attemptKey(target, attempt.attempt));
  const terminal =
    failure.code === "invalid_input" ||
    task.attemptsInCycle >= INFERENCE_MAX_ATTEMPTS;
  await db
    .update(inferenceTasks)
    .set({
      status: terminal ? "failed" : "queued",
      finishedAt: terminal ? at : null,
      error: failure.message,
      availableAt: new Date(
        at.getTime() + retryDelaySeconds(task.attemptsInCycle) * 1000,
      ),
    })
    .where(taskKey(target));
}

/** Claims and maintenance reclaim expired ownership without worker cooperation. */
async function expireInferenceAttempts(
  db: Executor,
  at: Date,
): Promise<number> {
  const rows = await db
    .select({ task: inferenceTasks, attempt: inferenceAttempts })
    .from(inferenceTasks)
    .innerJoin(
      inferenceAttempts,
      and(
        eq(inferenceTasks.imageId, inferenceAttempts.imageId),
        eq(inferenceTasks.modelVersionId, inferenceAttempts.modelVersionId),
        eq(inferenceTasks.attempt, inferenceAttempts.attempt),
      ),
    )
    .where(and(eq(inferenceTasks.status, "running"), not(attemptIsActive(at))))
    .orderBy(asc(inferenceTasks.modelVersionId), asc(inferenceTasks.imageId))
    .for("update", { of: inferenceTasks, skipLocked: true });
  let expired = 0;
  for (const row of rows) {
    // The join was read before the task lock. Re-read after locking so a
    // renewal committed during that SELECT cannot be mistaken for an expiry.
    const target = {
      digest: row.task.imageId,
      versionId: row.task.modelVersionId,
    };
    const task = await lockInferenceTask(target, db);
    if (task.status !== "running") continue;
    const [attempt] = await db
      .select()
      .from(inferenceAttempts)
      .where(attemptKey(target, task.attempt));
    if (attempt?.status !== "running") continue;
    const [live] = await db
      .select({ attempt: inferenceAttempts.attempt })
      .from(inferenceAttempts)
      .where(and(attemptKey(target, task.attempt), attemptIsActive(at)));
    if (live) continue;
    const code =
      attempt.deadlineAt <= at
        ? "timeout"
        : attempt.leaseExpiresAt <= at
          ? "lease_expired"
          : "session_replaced";
    await finishFailedAttempt(
      task,
      attempt,
      {
        code,
        message:
          code === "timeout"
            ? "Inference execution exceeded its deadline"
            : code === "lease_expired"
              ? "Worker did not renew its inference lease"
              : "Worker session ended",
      },
      at,
      db,
    );
    expired += 1;
  }
  return expired;
}

export async function maintainInferenceTasks(
  suppliedAt?: Date,
): Promise<number> {
  return transaction(async (db) => {
    const now = await operationTime(db, suppliedAt);
    await materializeInferenceDemand(now, db);
    return expireInferenceAttempts(db, now);
  });
}

export async function readInferenceTask(target: InferenceTarget) {
  return snapshot(async (db) => {
    const [task] = await db
      .select()
      .from(inferenceTasks)
      .where(taskKey(target));
    if (!task) return null;
    const attempts = await db
      .select()
      .from(inferenceAttempts)
      .where(
        and(
          eq(inferenceAttempts.imageId, target.digest),
          eq(inferenceAttempts.modelVersionId, target.versionId),
        ),
      )
      .orderBy(asc(inferenceAttempts.attempt));
    return inferenceTaskSchema.parse({
      ...target,
      status: task.status,
      attempt: task.attempt,
      attemptsInCycle: task.attemptsInCycle,
      availableAt: task.availableAt.toISOString(),
      error: task.error,
      attempts: attempts.map((a) => ({
        attempt: a.attempt,
        workerId: a.workerId,
        sessionId: a.sessionId,
        status: a.status,
        failure: a.failure,
        startedAt: a.startedAt.toISOString(),
        deadlineAt: a.deadlineAt.toISOString(),
        leaseExpiresAt: a.leaseExpiresAt.toISOString(),
        finishedAt: a.finishedAt?.toISOString() ?? null,
      })),
    });
  });
}

/** An explicit retry starts a fresh budget without reusing execution identities. */
export async function retryInferenceTask(
  target: InferenceTarget,
  db?: Executor,
): Promise<void> {
  await inTransaction(db, async (db) => {
    const task = await lockInferenceTask(target, db);
    if (task.status !== "failed") return;
    const at = await operationTime(db);
    await db
      .update(inferenceTasks)
      .set({
        status: "queued",
        attemptsInCycle: 0,
        availableAt: at,
        finishedAt: null,
        error: null,
      })
      .where(taskKey(target));
  });
}
