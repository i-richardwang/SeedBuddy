import { InferenceAttemptConflictError } from "../../domain/inference/errors";
import { and, asc, eq, gt, lte, not, or, sql } from "drizzle-orm";
import {
  snapshot,
  inTransaction,
  transaction,
  type Executor,
} from "../infra/db/client";
import { inferenceTasks, inferenceAttempts } from "../infra/db/schema";
import { sessionIsCurrent } from "../workers/public";
import type { InferenceFailure } from "../../domain/inference/tasks";
import { inferenceTaskSchema } from "../../domain/inference/tasks";
import type { DetectionTarget } from "./outcomes";
import { materializeInferenceDemand } from "./demand";
import { INFERENCE_MAX_ATTEMPTS, retryDelaySeconds } from "./policy";

export type Task = typeof inferenceTasks.$inferSelect;
export type Attempt = typeof inferenceAttempts.$inferSelect;

export function taskKey(target: DetectionTarget) {
  return and(
    eq(inferenceTasks.imageId, target.digest),
    eq(inferenceTasks.modelVersionId, target.versionId),
  );
}
export function attemptKey(target: DetectionTarget, attempt: number) {
  return and(
    eq(inferenceAttempts.imageId, target.digest),
    eq(inferenceAttempts.modelVersionId, target.versionId),
    eq(inferenceAttempts.attempt, attempt),
  );
}
export function attemptIsActive(at: Date) {
  return and(
    eq(inferenceAttempts.status, "running"),
    gt(inferenceAttempts.leaseExpiresAt, at),
    gt(inferenceAttempts.deadlineAt, at),
    sessionIsCurrent(inferenceAttempts),
  );
}
/** Sample server time after acquiring ownership locks, never before waiting on one. */
export async function inferenceTime(tx: Executor, at?: Date): Promise<Date> {
  if (at) return at;
  const [row] = await tx
    .select({ at: sql<string>`clock_timestamp()::text` })
    .from(sql`(select 1) as clock`);
  return new Date(row!.at);
}
export async function lockTask(
  tx: Executor,
  target: DetectionTarget,
): Promise<Task> {
  const [task] = await tx
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
  tx: Executor,
  task: Task,
  attempt: Attempt,
  failure: InferenceFailure,
  at: Date,
): Promise<void> {
  const target = { digest: task.imageId, versionId: task.modelVersionId };
  await tx
    .update(inferenceAttempts)
    .set({ status: "failed", finishedAt: at, failure })
    .where(attemptKey(target, attempt.attempt));
  const terminal =
    failure.code === "invalid_input" ||
    task.attemptsInCycle >= INFERENCE_MAX_ATTEMPTS;
  await tx
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
  tx: Executor,
  suppliedAt?: Date,
): Promise<number> {
  const at = await inferenceTime(tx, suppliedAt);
  const rows = await tx
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
    .where(
      and(
        eq(inferenceTasks.status, "running"),
        or(
          lte(inferenceAttempts.leaseExpiresAt, at),
          lte(inferenceAttempts.deadlineAt, at),
          not(sessionIsCurrent(inferenceAttempts)),
        ),
      ),
    )
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
    const task = await lockTask(tx, target);
    if (task.status !== "running") continue;
    const [attempt] = await tx
      .select()
      .from(inferenceAttempts)
      .where(attemptKey(target, task.attempt));
    if (attempt?.status !== "running") continue;
    const checkedAt = await inferenceTime(tx, suppliedAt);
    const [live] = await tx
      .select({ attempt: inferenceAttempts.attempt })
      .from(inferenceAttempts)
      .where(and(attemptKey(target, task.attempt), attemptIsActive(checkedAt)));
    if (live) continue;
    const code =
      attempt.deadlineAt <= checkedAt
        ? "timeout"
        : attempt.leaseExpiresAt <= checkedAt
          ? "lease_expired"
          : "session_replaced";
    await finishFailedAttempt(
      tx,
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
      checkedAt,
    );
    expired += 1;
  }
  return expired;
}

export async function maintainInferenceTasks(at?: Date): Promise<number> {
  return transaction(async (tx) => {
    const now = await inferenceTime(tx, at);
    await materializeInferenceDemand(tx, now);
    return expireInferenceAttempts(tx, at);
  });
}

export async function readInferenceTask(target: DetectionTarget) {
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
  target: DetectionTarget,
  executor?: Executor,
): Promise<void> {
  await inTransaction(executor, async (tx) => {
    const task = await lockTask(tx, target);
    if (task.status !== "failed") return;
    const at = await inferenceTime(tx);
    await tx
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
