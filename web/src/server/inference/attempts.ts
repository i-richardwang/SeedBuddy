import { InferenceAttemptConflictError } from "../../domain/inference/errors";
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import { transaction, type Executor } from "../infra/db/client";
import {
  inferenceTasks,
  inferenceAttempts,
  modelVersions,
  trainingRuns,
} from "../infra/db/schema";
import {
  inferenceAssignmentSchema,
  inferenceModelManifest,
} from "../../domain/inference/assignments";
import {
  detectionResultSchema,
  type DetectionResult,
} from "../../domain/detection/schema";
import type {
  InferenceAttemptOwner,
  InferenceFailure,
} from "../../domain/inference/tasks";
import type { Worker, WorkerIdentity } from "../../domain/workers/schema";
import { readModel, toModelVersion } from "../models/public";
import { lockWorkerSession, leaseIsHeld } from "../workers/public";
import { contentDigest } from "../infra/digest";
import { canonicalJson } from "../../lib/json/canonical";
import { storeInferenceOutcome, type DetectionTarget } from "./outcomes";
import {
  INFERENCE_LEASE_SECONDS,
  INFERENCE_WORKER_COOLDOWN_SECONDS,
  inferenceBudgetSeconds,
} from "./policy";
import {
  attemptIsActive,
  attemptKey,
  maintainInferenceTasks,
  finishFailedAttempt,
  inferenceTime,
  lockTask,
  taskKey,
  type Attempt,
  type Task,
} from "./tasks";

async function assignment(
  tx: Executor,
  task: Task,
  attempt: Attempt,
  at: Date,
) {
  const [row] = await tx
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.id, task.modelVersionId));
  if (!row) throw new Error(`Missing model version ${task.modelVersionId}`);
  const version = toModelVersion(row);
  const model = await readModel(version.modelId, tx);
  if (!model) throw new Error(`Missing model ${version.modelId}`);
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
export async function claimInferenceAssignment(
  owner: WorkerIdentity,
  suppliedAt?: Date,
) {
  // Reconciliation owns task locks only. Complete it before locking this
  // worker's slot, so concurrent reclaimers cannot invert worker/task locks.
  await maintainInferenceTasks(suppliedAt);
  return transaction(async (tx) => {
    const worker = await lockWorkerSession(owner, tx);
    let at = await inferenceTime(tx, suppliedAt);
    const [held] = await tx
      .select()
      .from(inferenceAttempts)
      .where(
        and(
          eq(inferenceAttempts.workerId, worker.workerId),
          eq(inferenceAttempts.status, "running"),
        ),
      );
    if (held) {
      const task = await lockTask(tx, {
        digest: held.imageId,
        versionId: held.modelVersionId,
      });
      at = await inferenceTime(tx, suppliedAt);
      const [live] = await tx
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
      return live ? assignment(tx, task, live, at) : null;
    }
    const [training] = await tx
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
    const [cooling] = await tx
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
    const [candidate] = await tx
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
    at = await inferenceTime(tx, suppliedAt);
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
    const [stored] = await tx
      .insert(inferenceAttempts)
      .values(attempt)
      .returning();
    const [updated] = await tx
      .update(inferenceTasks)
      .set({
        status: "running",
        attempt: attempt.attempt,
        attemptsInCycle: task.attemptsInCycle + 1,
        error: null,
      })
      .where(taskKey({ digest: task.imageId, versionId: task.modelVersionId }))
      .returning();
    return assignment(tx, updated!, stored!, at);
  });
}

async function ownedAttempt(
  tx: Executor,
  target: DetectionTarget,
  owner: InferenceAttemptOwner,
): Promise<Attempt> {
  const [attempt] = await tx
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

export async function renewInferenceClaim(
  target: DetectionTarget,
  owner: InferenceAttemptOwner,
  suppliedAt?: Date,
) {
  return transaction(async (tx) => {
    await lockWorkerSession(owner, tx);
    const task = await lockTask(tx, target);
    const attempt = await ownedAttempt(tx, target, owner);
    const at = await inferenceTime(tx, suppliedAt);
    requireLive(task, attempt, at);
    const leaseExpiresAt = new Date(
      Math.min(
        attempt.deadlineAt.getTime(),
        at.getTime() + INFERENCE_LEASE_SECONDS * 1000,
      ),
    );
    await tx
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
export async function completeInferenceClaim(
  target: DetectionTarget,
  result: DetectionResult,
  owner: InferenceAttemptOwner,
  suppliedAt?: Date,
): Promise<void> {
  await transaction(async (tx) => {
    const worker: Worker = await lockWorkerSession(owner, tx);
    const task = await lockTask(tx, target);
    const attempt = await ownedAttempt(tx, target, owner);
    const parsed = detectionResultSchema.parse(result);
    const digest = contentDigest(canonicalJson(parsed));
    if (attempt.status === "succeeded" && attempt.resultDigest === digest)
      return;
    requireLive(task, attempt, await inferenceTime(tx, suppliedAt));
    await storeInferenceOutcome(target, parsed, worker, tx);
    const at = await inferenceTime(tx, suppliedAt);
    requireLive(task, attempt, at);
    await tx
      .update(inferenceAttempts)
      .set({ status: "succeeded", finishedAt: at, resultDigest: digest })
      .where(attemptKey(target, attempt.attempt));
    await tx
      .update(inferenceTasks)
      .set({ status: "succeeded", finishedAt: at, error: null })
      .where(taskKey(target));
  });
}

export async function failInferenceAttempt(
  target: DetectionTarget,
  failure: InferenceFailure,
  owner: InferenceAttemptOwner,
  suppliedAt?: Date,
): Promise<void> {
  await transaction(async (tx) => {
    await lockWorkerSession(owner, tx);
    const task = await lockTask(tx, target);
    const attempt = await ownedAttempt(tx, target, owner);
    if (
      attempt.status === "failed" &&
      canonicalJson(attempt.failure) === canonicalJson(failure)
    )
      return;
    const at = await inferenceTime(tx, suppliedAt);
    requireLive(task, attempt, at);
    await finishFailedAttempt(tx, task, attempt, failure, at);
  });
}
