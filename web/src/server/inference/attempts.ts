import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";

import type { DetectionResult } from "../../domain/detection/schema";
import type { InferenceTarget } from "../../domain/inference/assignments";
import {
  inferenceAssignmentSchema,
  inferenceModelManifest,
} from "../../domain/inference/assignments";
import { InferenceAttemptConflictError } from "../../domain/inference/errors";
import type { InferenceFailure } from "../../domain/inference/tasks";
import type { AttemptOwner, WorkerIdentity } from "../../domain/workers/schema";
import { canonicalJson } from "../../lib/json/canonical";
import {
  type Executor,
  operationTime,
  single,
  transaction,
} from "../infra/db/client";
import {
  inferenceAttempts,
  inferenceTasks,
  modelVersions,
  trainingRuns,
} from "../infra/db/schema";
import { documentDigest } from "../infra/digest";
import { requireModel, toModelVersion } from "../models/public";
import { leaseIsHeld, lockWorkerSession } from "../workers/public";
import { storeInferenceOutcome } from "./outcomes";
import {
  INFERENCE_LEASE_SECONDS,
  INFERENCE_WORKER_COOLDOWN_SECONDS,
  inferenceBudgetSeconds,
} from "./policy";
import {
  type Attempt,
  attemptIsActive,
  attemptKey,
  finishFailedAttempt,
  lockInferenceTask,
  maintainInferenceTasks,
  type Task,
  taskKey,
} from "./tasks";

async function assignment(
  db: Executor,
  task: Task,
  attempt: Attempt,
  at: Date,
) {
  const row = single(
    await db
      .select()
      .from(modelVersions)
      .where(eq(modelVersions.id, task.modelVersionId)),
    "model_versions",
  );
  const version = toModelVersion(row);
  const model = await requireModel(version.modelId, db);
  return inferenceAssignmentSchema.parse({
    manifest: inferenceModelManifest(version, model),
    image: task.imageId,
    attempt: attempt.attempt,
    leaseExpiresAt: attempt.leaseExpiresAt.toISOString(),
    deadlineAt: attempt.deadlineAt.toISOString(),
    serverTime: at.toISOString(),
  });
}

/** One execution slot, with idempotent claim delivery and no private backlog. */
export async function claimInferenceTask(
  owner: WorkerIdentity,
  suppliedAt?: Date,
) {
  // Reconciliation owns task locks only. Complete it before locking this
  // worker's slot, so concurrent reclaimers cannot invert worker/task locks.
  await maintainInferenceTasks(suppliedAt);
  return transaction(async (db) => {
    const worker = await lockWorkerSession(owner, db);
    const [held] = await db
      .select()
      .from(inferenceAttempts)
      .where(
        and(
          eq(inferenceAttempts.workerId, worker.workerId),
          eq(inferenceAttempts.status, "running"),
        ),
      );
    if (held) {
      const task = await lockInferenceTask(
        {
          digest: held.imageId,
          versionId: held.modelVersionId,
        },
        db,
      );

      const at = await operationTime(db, suppliedAt);
      const [live] = await db
        .select()
        .from(inferenceAttempts)
        .where(
          and(
            attemptKey(
              { digest: held.imageId, versionId: held.modelVersionId },
              held.attempt,
            ),
            attemptIsActive(at),
          ),
        );
      return live ? assignment(db, task, live, at) : null;
    }
    const at = await operationTime(db, suppliedAt);
    const [training] = await db
      .select({ id: trainingRuns.id })
      .from(trainingRuns)
      .where(
        and(
          eq(trainingRuns.workerId, owner.workerId),
          leaseIsHeld(trainingRuns, at),
        ),
      )
      .limit(1);
    if (training) return null;
    const [cooling] = await db
      .select({ attempt: inferenceAttempts.attempt })
      .from(inferenceAttempts)
      .where(
        and(
          eq(inferenceAttempts.workerId, owner.workerId),
          eq(inferenceAttempts.status, "failed"),
          gt(
            inferenceAttempts.finishedAt,
            new Date(at.getTime() - INFERENCE_WORKER_COOLDOWN_SECONDS * 1000),
          ),
        ),
      )
      .limit(1);
    if (cooling) return null;
    const kinds = [...new Set(worker.runtimes.map((r) => r.adapter))];
    if (!kinds.length) return null;
    const [candidate] = await db
      .select({ task: inferenceTasks, version: modelVersions })
      .from(inferenceTasks)
      .innerJoin(
        modelVersions,
        eq(modelVersions.id, inferenceTasks.modelVersionId),
      )
      .where(
        and(
          eq(inferenceTasks.status, "queued"),
          lte(inferenceTasks.availableAt, at),
          inArray(modelVersions.artifactKind, kinds),
        ),
      )
      .orderBy(
        asc(inferenceTasks.availableAt),
        asc(inferenceTasks.modelVersionId),
        asc(inferenceTasks.imageId),
      )
      .limit(1)
      .for("update", { of: inferenceTasks, skipLocked: true });
    if (!candidate) return null;

    const { task } = candidate;
    const deadlineAt = new Date(
      at.getTime() +
        inferenceBudgetSeconds(toModelVersion(candidate.version).artifact) *
          1000,
    );
    const attempt: typeof inferenceAttempts.$inferInsert = {
      imageId: task.imageId,
      modelVersionId: task.modelVersionId,
      attempt: task.attempt + 1,
      workerId: owner.workerId,
      sessionId: owner.sessionId,
      startedAt: at,
      deadlineAt,
      leaseExpiresAt: new Date(
        Math.min(
          deadlineAt.getTime(),
          at.getTime() + INFERENCE_LEASE_SECONDS * 1000,
        ),
      ),
      status: "running",
    };
    const stored = single(
      await db.insert(inferenceAttempts).values(attempt).returning(),
      "inferenceAttempts",
    );
    const updated = single(
      await db
        .update(inferenceTasks)
        .set({
          status: "running",
          attempt: attempt.attempt,
          attemptsInCycle: task.attemptsInCycle + 1,
          error: null,
        })
        .where(
          taskKey({ digest: task.imageId, versionId: task.modelVersionId }),
        )
        .returning(),
      "inferenceTasks",
    );
    return assignment(db, updated, stored, at);
  });
}

async function ownedAttempt(
  db: Executor,
  target: InferenceTarget,
  owner: AttemptOwner,
): Promise<Attempt> {
  const [attempt] = await db
    .select()
    .from(inferenceAttempts)
    .where(
      and(
        attemptKey(target, owner.attempt),
        eq(inferenceAttempts.workerId, owner.workerId),
        eq(inferenceAttempts.sessionId, owner.sessionId),
      ),
    );
  if (!attempt)
    throw new InferenceAttemptConflictError(
      "This execution does not own the inference attempt",
    );
  return attempt;
}
function requireLive(task: Task, attempt: Attempt, at: Date): void {
  if (
    task.status !== "running" ||
    task.attempt !== attempt.attempt ||
    attempt.status !== "running" ||
    attempt.leaseExpiresAt <= at ||
    attempt.deadlineAt <= at
  )
    throw new InferenceAttemptConflictError(
      "Inference execution is expired or superseded",
    );
}

export async function renewInferenceTask(
  target: InferenceTarget,
  owner: AttemptOwner,
  suppliedAt?: Date,
) {
  return transaction(async (db) => {
    await lockWorkerSession(owner, db);
    const task = await lockInferenceTask(target, db);
    const attempt = await ownedAttempt(db, target, owner);
    const at = await operationTime(db, suppliedAt);
    requireLive(task, attempt, at);
    const leaseExpiresAt = new Date(
      Math.min(
        attempt.deadlineAt.getTime(),
        at.getTime() + INFERENCE_LEASE_SECONDS * 1000,
      ),
    );
    await db
      .update(inferenceAttempts)
      .set({ leaseExpiresAt })
      .where(attemptKey(target, attempt.attempt));
    return {
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      deadlineAt: attempt.deadlineAt.toISOString(),
      serverTime: at.toISOString(),
    };
  });
}

/** Receipt replay remains safe after expiry; uncommitted stale results never land. */
export async function completeInferenceTask(
  target: InferenceTarget,
  result: DetectionResult,
  owner: AttemptOwner,
  suppliedAt?: Date,
): Promise<void> {
  await transaction(async (db) => {
    const worker = await lockWorkerSession(owner, db);
    const task = await lockInferenceTask(target, db);
    const attempt = await ownedAttempt(db, target, owner);
    const digest = documentDigest(result);
    if (attempt.status === "succeeded" && attempt.resultDigest === digest)
      return;
    const at = await operationTime(db, suppliedAt);
    requireLive(task, attempt, at);
    await storeInferenceOutcome(target, result, worker, at, db);
    await db
      .update(inferenceAttempts)
      .set({ status: "succeeded", finishedAt: at, resultDigest: digest })
      .where(attemptKey(target, attempt.attempt));
    await db
      .update(inferenceTasks)
      .set({ status: "succeeded", finishedAt: at, error: null })
      .where(taskKey(target));
  });
}

export async function failInferenceTask(
  target: InferenceTarget,
  failure: InferenceFailure,
  owner: AttemptOwner,
  suppliedAt?: Date,
): Promise<void> {
  await transaction(async (db) => {
    await lockWorkerSession(owner, db);
    const task = await lockInferenceTask(target, db);
    const attempt = await ownedAttempt(db, target, owner);
    if (
      attempt.status === "failed" &&
      canonicalJson(attempt.failure) === canonicalJson(failure)
    )
      return;
    const at = await operationTime(db, suppliedAt);
    requireLive(task, attempt, at);
    await finishFailedAttempt(task, attempt, failure, at, db);
  });
}
