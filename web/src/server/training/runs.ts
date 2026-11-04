import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, gt, inArray, isNull, not, or } from "drizzle-orm";

import { DatasetNotFoundError } from "../../domain/datasets/errors";
import {
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../domain/training/errors";
import {
  ACTIVE_TRAINING_RUN_STATUSES,
  type TrainingEpochReport,
  type TrainingPhase,
  type TrainingRecipe,
  type TrainingRun,
  trainingRunId,
} from "../../domain/training/schema";
import {
  type AttemptOwner,
  canTrain,
  type WorkerIdentity,
} from "../../domain/workers/schema";
import { readDataset } from "../datasets/public";
import {
  type Executor,
  operationTime,
  single,
  transaction,
} from "../infra/db/client";
import {
  datasetSnapshots,
  inferenceAttempts,
  trainingAttempts,
  trainingRuns,
} from "../infra/db/schema";
import { leaseIsHeld, lockWorkerSession } from "../workers/public";
import { finishAttempt } from "./attempts";
import { latestTrainingEpoch, saveTrainingEpoch } from "./epochs";
import { toTrainingRun } from "./records";
import { ownershipConflict, requireTrainingRun } from "./runs-access";
import { createDatasetSnapshot } from "./snapshots";
import { validateTrainingTarget } from "./targets";

const MESSAGE_LIMIT = 2000;
const LEASE_MILLISECONDS = 5 * 60 * 1000;
const PHASE_PROGRESS: Record<TrainingPhase, number> = {
  preparing: 0,
  training: 0.05,
  validating: 0.9,
};
const TRAINING_PROGRESS_RANGE =
  PHASE_PROGRESS.validating - PHASE_PROGRESS.training;
const NEXT_PHASE: Record<TrainingPhase, TrainingPhase | null> = {
  preparing: "training",
  training: "validating",
  validating: null,
};

type Row = typeof trainingRuns.$inferSelect;

/** Every state column, so a transition never leaves stale values behind. */
function stateColumns(
  state: TrainingRun["state"],
): Pick<
  Row,
  | "status"
  | "workerId"
  | "sessionId"
  | "leaseExpiresAt"
  | "phase"
  | "progress"
  | "error"
  | "modelVersionId"
> {
  const cleared = {
    workerId: null,
    sessionId: null,
    leaseExpiresAt: null,
    phase: null,
    progress: null,
    error: null,
    modelVersionId: null,
  };
  switch (state.status) {
    case "paused":
    case "cancelled":
    case "queued":
      return { ...cleared, status: state.status };
    case "running":
      return {
        ...cleared,
        status: state.status,
        workerId: state.workerId,
        sessionId: state.sessionId,
        leaseExpiresAt: new Date(state.leaseExpiresAt),
        phase: state.phase,
        progress: state.progress,
      };
    case "succeeded":
      return {
        ...cleared,
        status: state.status,
        modelVersionId: state.modelVersionId,
      };
    case "failed":
      return { ...cleared, status: state.status, error: state.error };
  }
}

export async function transitionTrainingRun(
  runId: string,
  state: TrainingRun["state"],
  at: Date,
  db: Executor,
): Promise<TrainingRun> {
  const row = single(
    await db
      .update(trainingRuns)
      .set({
        ...stateColumns(state),
        ...(state.status === "cancelled" || state.status === "succeeded"
          ? { checkpoint: null }
          : {}),
      })
      .where(eq(trainingRuns.id, runId))
      .returning(),
    "training_runs",
  );
  const run = toTrainingRun(row);
  if (state.status !== "running" && state.status !== "queued") {
    await finishAttempt(
      run,
      state.status,
      state.status === "failed" ? state.error : null,
      at,
      db,
    );
  }
  return run;
}

function ownedBy(owner: AttemptOwner, at: Date) {
  return and(
    eq(trainingRuns.status, "running"),
    eq(trainingRuns.workerId, owner.workerId),
    eq(trainingRuns.sessionId, owner.sessionId),
    eq(trainingRuns.attempt, owner.attempt),
    leaseIsHeld(trainingRuns, at),
  );
}

/** The update itself fences writes from expired or replaced owners. */
async function fencedUpdate(
  runId: string,
  owner: AttemptOwner,
  set: Partial<typeof trainingRuns.$inferInsert>,
  at: Date,
  db: Executor,
): Promise<TrainingRun> {
  const [row] = await db
    .update(trainingRuns)
    .set(set)
    .where(and(eq(trainingRuns.id, runId), ownedBy(owner, at)))
    .returning();
  if (!row) {
    await requireTrainingRun(runId, db);
    throw ownershipConflict(runId, owner);
  }
  return toTrainingRun(row);
}

function leaseUntil(at: Date): Date {
  return new Date(at.getTime() + LEASE_MILLISECONDS);
}

/**
 * Whether a run's worker still holds it at `at`, judged as a claim judges
 * it; a run nobody runs is held by no one.
 */
export async function trainingLeaseIsHeld(
  runId: string,
  at: Date,
  db: Executor,
): Promise<boolean> {
  const [row] = await db
    .select({ held: leaseIsHeld(trainingRuns, at) })
    .from(trainingRuns)
    .where(eq(trainingRuns.id, runId));
  return row?.held === true;
}

export async function latestTrainingRun(
  datasetId: string,
  db: Executor,
): Promise<TrainingRun | null> {
  const [row] = await db
    .select({ run: trainingRuns })
    .from(trainingRuns)
    .innerJoin(
      datasetSnapshots,
      eq(datasetSnapshots.id, trainingRuns.datasetSnapshotId),
    )
    .where(eq(datasetSnapshots.datasetId, datasetId))
    .orderBy(desc(trainingRuns.createdAt), desc(trainingRuns.id))
    .limit(1);
  return row ? toTrainingRun(row.run) : null;
}

export async function activeTrainingRun(
  modelId: string,
  db: Executor,
): Promise<TrainingRun | null> {
  const [row] = await db
    .select()
    .from(trainingRuns)
    .where(
      and(
        eq(trainingRuns.modelId, modelId),
        inArray(trainingRuns.status, [...ACTIVE_TRAINING_RUN_STATUSES]),
      ),
    );
  return row ? toTrainingRun(row) : null;
}

export async function createTrainingRun(
  datasetId: string,
  recipe: TrainingRecipe,
  targetWorkerId: string | null,
): Promise<TrainingRun> {
  await validateTrainingTarget(targetWorkerId);
  return transaction(async (db) => {
    const dataset = await readDataset(datasetId, db);
    if (!dataset)
      throw new DatasetNotFoundError(`Unknown dataset: ${datasetId}`);
    const active = await activeTrainingRun(dataset.modelId, db);
    if (active) {
      throw new TrainingRunConflictError(
        `Training run ${active.id} is still active for ${dataset.modelId}`,
      );
    }
    const at = await operationTime(db);
    const snapshot = await createDatasetSnapshot(datasetId, at, db);
    const runId = trainingRunId(randomUUID());
    const row = single(
      await db
        .insert(trainingRuns)
        .values({
          id: runId,
          modelId: snapshot.modelId,
          datasetSnapshotId: snapshot.id,
          createdAt: at,
          attempt: 0,
          targetWorkerId,
          recipe,
          ...stateColumns({ status: "queued" }),
        })
        .returning(),
      "trainingRuns",
    );
    return toTrainingRun(row);
  });
}

/**
 * Leases the oldest claimable run to a worker session. A live session gets its
 * run back idempotently; a run whose lease no longer holds starts a fresh
 * attempt under whichever session claims it first.
 */
export async function claimTrainingRun(
  owner: WorkerIdentity,
  suppliedAt?: Date,
): Promise<TrainingRun | null> {
  return transaction(async (db) => {
    const worker = await lockWorkerSession(owner, db);
    const at = await operationTime(db, suppliedAt);
    if (!canTrain(worker)) return null;
    const [inference] = await db
      .select({ attempt: inferenceAttempts.attempt })
      .from(inferenceAttempts)
      .where(
        and(
          eq(inferenceAttempts.workerId, owner.workerId),
          eq(inferenceAttempts.status, "running"),
          gt(inferenceAttempts.deadlineAt, at),
          leaseIsHeld(inferenceAttempts, at),
        ),
      )
      .limit(1);
    if (inference) return null;
    const [owned] = await db
      .select()
      .from(trainingRuns)
      .where(
        and(
          eq(trainingRuns.status, "running"),
          eq(trainingRuns.workerId, owner.workerId),
          eq(trainingRuns.sessionId, owner.sessionId),
          leaseIsHeld(trainingRuns, at),
        ),
      );
    if (owned) return toTrainingRun(owned);
    const [candidate] = await db
      .select()
      .from(trainingRuns)
      .where(
        and(
          or(
            isNull(trainingRuns.targetWorkerId),
            eq(trainingRuns.targetWorkerId, owner.workerId),
          ),
          or(
            eq(trainingRuns.status, "queued"),
            and(
              eq(trainingRuns.status, "running"),
              not(leaseIsHeld(trainingRuns, at)),
            ),
          ),
        ),
      )
      .orderBy(asc(trainingRuns.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    if (candidate.status === "running")
      await finishAttempt(toTrainingRun(candidate), "expired", null, at, db);
    await db.insert(trainingAttempts).values({
      runId: candidate.id,
      attempt: candidate.attempt + 1,
      workerId: owner.workerId,
      startedAt: at,
    });
    const row = single(
      await db
        .update(trainingRuns)
        .set({
          attempt: candidate.attempt + 1,
          targetWorkerId: owner.workerId,
          lastProgressAt: at,
          ...stateColumns({
            status: "running",
            workerId: owner.workerId,
            sessionId: owner.sessionId,
            leaseExpiresAt: leaseUntil(at).toISOString(),
            phase: "preparing",
            progress: 0,
          }),
        })
        .where(eq(trainingRuns.id, candidate.id))
        .returning(),
      "trainingRuns",
    );
    return toTrainingRun(row);
  });
}

export async function lockTrainingRun(
  runId: string,
  db: Executor,
): Promise<TrainingRun> {
  const [row] = await db
    .select()
    .from(trainingRuns)
    .where(eq(trainingRuns.id, runId))
    .for("update");
  if (!row)
    throw new TrainingRunNotFoundError(`Unknown training run: ${runId}`);
  return toTrainingRun(row);
}

/** Renew ownership without changing the run's phase or business progress. */
export async function renewTrainingRun(
  runId: string,
  owner: AttemptOwner,
  suppliedAt?: Date,
): Promise<TrainingRun> {
  return transaction(async (db) => {
    const at = await operationTime(db, suppliedAt);
    return fencedUpdate(
      runId,
      owner,
      { leaseExpiresAt: leaseUntil(at) },
      at,
      db,
    );
  });
}

/** Advance through the ordered execution phases; retries are idempotent. */
export async function enterTrainingPhase(
  runId: string,
  phase: TrainingPhase,
  owner: AttemptOwner,
  suppliedAt?: Date,
): Promise<TrainingRun> {
  return transaction(async (db) => {
    const current = await lockTrainingRun(runId, db);
    const at = await operationTime(db, suppliedAt);
    if (current.state.status !== "running")
      throw ownershipConflict(runId, owner);
    if (
      phase !== current.state.phase &&
      phase !== NEXT_PHASE[current.state.phase]
    ) {
      throw new TrainingRunConflictError(
        `Training run ${runId} cannot move from ${current.state.phase} to ${phase}`,
      );
    }

    return fencedUpdate(
      runId,
      owner,
      {
        ...stateColumns({
          status: "running",
          workerId: owner.workerId,
          sessionId: owner.sessionId,
          leaseExpiresAt: leaseUntil(at).toISOString(),
          phase,
          progress: Math.max(current.state.progress, PHASE_PROGRESS[phase]),
        }),
        ...(phase !== current.state.phase ? { lastProgressAt: at } : {}),
      },
      at,
      db,
    );
  });
}

/**
 * Records one finished epoch and carries the run's progress with it. A repeated
 * report for the same epoch replaces the row, so a retried upload is harmless.
 */
export async function recordTrainingEpoch(
  runId: string,
  report: TrainingEpochReport,
  owner: AttemptOwner,
  suppliedAt?: Date,
): Promise<TrainingRun> {
  return transaction(async (db) => {
    const current = await lockTrainingRun(runId, db);
    const at = await operationTime(db, suppliedAt);
    if (current.state.status !== "running")
      throw ownershipConflict(runId, owner);
    if (current.state.phase !== "training") {
      throw new TrainingRunConflictError(
        `Training run ${runId} cannot record epochs while ${current.state.phase}`,
      );
    }
    const total = current.recipe.parameters.epochs;
    if (report.epoch > total) {
      throw new TrainingRunConflictError(
        `Training run ${runId} has ${total} epochs, not ${report.epoch}`,
      );
    }
    const previous = await latestTrainingEpoch(runId, owner.attempt, db);
    const advanced = previous === null || report.epoch > previous;
    await saveTrainingEpoch(runId, current.attempt, report, at, db);
    return fencedUpdate(
      runId,
      owner,
      {
        ...stateColumns({
          status: "running",
          workerId: owner.workerId,
          sessionId: owner.sessionId,
          leaseExpiresAt: leaseUntil(at).toISOString(),
          phase: "training",
          progress: Math.max(
            current.state.progress,
            PHASE_PROGRESS.training +
              TRAINING_PROGRESS_RANGE * (report.epoch / total),
          ),
        }),
        ...(advanced
          ? {
              lastProgressAt: at,
              checkpoint:
                current.checkpoint && report.epoch < current.checkpoint.epoch
                  ? current.checkpoint
                  : {
                      attempt: owner.attempt,
                      epoch: report.epoch,
                      workerId: owner.workerId,
                    },
            }
          : {}),
      },
      at,
      db,
    );
  });
}

export async function failTrainingRun(
  runId: string,
  error: string,
  owner: AttemptOwner,
): Promise<TrainingRun> {
  return transaction(async (db) => {
    const at = await operationTime(db);
    const run = await fencedUpdate(
      runId,
      owner,
      stateColumns({ status: "failed", error: error.slice(0, MESSAGE_LIMIT) }),
      at,
      db,
    );
    await finishAttempt(run, "failed", error.slice(0, MESSAGE_LIMIT), at, db);
    return run;
  });
}
