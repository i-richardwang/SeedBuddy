import type { AttemptOwner } from "../../domain/workers/schema";
import { inferenceAttempts } from "../infra/db/schema";
import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  not,
  or,
  sql,
} from "drizzle-orm";

import { database, transaction, type Executor } from "../infra/db/client";
import {
  datasetSnapshots,
  datasets,
  trainingEpochs,
  trainingRuns,
  trainingAttempts,
} from "../infra/db/schema";
import {
  ACTIVE_TRAINING_RUN_STATUSES,
  trainingEpochSchema,
  trainingRecipeSchema,
  trainingRunId,
  trainingRunSchema,
  type TrainingEpoch,
  type TrainingEpochReport,
  type TrainingPhase,
  type TrainingRecipe,
  type TrainingRun,
} from "../../domain/training/schema";
import type { TrainingRunSummary } from "../../domain/training/read-model";
import { canTrain, type WorkerIdentity } from "../../domain/workers/schema";
import { DatasetNotFoundError } from "../../domain/datasets/errors";
import {
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../domain/training/errors";
import { createDatasetSnapshot, readDatasetSnapshot } from "./snapshots";
import { finishAttempt } from "./attempts";
import { readDataset } from "../datasets/public";
import {
  currentWorkerSession,
  listEnrolledWorkers,
  listWorkers,
  leaseIsHeld,
  lockWorkerSession,
  sessionIsCurrent,
} from "../workers/public";

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

/** A workbench page stays bounded while exact totals remain separate. */
const TRAINING_RUN_LIST_LIMIT = 100;

type Row = typeof trainingRuns.$inferSelect;
type EpochRow = typeof trainingEpochs.$inferSelect;
type RunningTrainingRun = TrainingRun & {
  state: Extract<TrainingRun["state"], { status: "running" }>;
};

export function requireTrainingRunRow(
  row: Row | undefined,
  runId: string,
): TrainingRun {
  if (!row)
    throw new TrainingRunNotFoundError(`Unknown training run: ${runId}`);
  return toRun(row);
}

function toRun(row: Row): TrainingRun {
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

function toEpoch(row: EpochRow): TrainingEpoch {
  return trainingEpochSchema.parse({
    epoch: row.epoch,
    recordedAt: row.recordedAt.toISOString(),
    train: {
      box: row.trainBoxLoss,
      classification: row.trainClassificationLoss,
      regression: row.trainRegressionLoss,
    },
    val: {
      box: row.valBoxLoss,
      classification: row.valClassificationLoss,
      regression: row.valRegressionLoss,
    },
    precision: row.precision,
    recall: row.recall,
    map50: row.map50,
    map50To95: row.map50To95,
    fitness: row.fitness,
    learningRate: row.learningRate,
  });
}

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
  db: Executor,
): Promise<TrainingRun> {
  const [row] = await db
    .update(trainingRuns)
    .set({
      ...stateColumns(state),
      ...(state.status === "cancelled" || state.status === "succeeded"
        ? { checkpoint: null }
        : {}),
    })
    .where(eq(trainingRuns.id, runId))
    .returning();
  const run = requireTrainingRunRow(row, runId);
  if (state.status !== "running" && state.status !== "queued") {
    await finishAttempt(
      run,
      state.status,
      db,
      state.status === "failed" ? state.error : null,
    );
  }
  return run;
}

export async function validateTrainingTarget(targetWorkerId: string | null) {
  if (
    targetWorkerId !== null &&
    !(await listEnrolledWorkers()).includes(targetWorkerId)
  ) {
    throw new TrainingRunConflictError(`Unknown worker: ${targetWorkerId}`);
  }
  const worker = (await listWorkers()).find(
    (worker) => worker.workerId === targetWorkerId,
  );
  if (worker && !canTrain(worker)) {
    throw new TrainingRunConflictError(`Worker ${targetWorkerId} cannot train`);
  }
}

/**
 * Applies a worker's transition only while the run is still leased to it; the
 * predicate is evaluated by the update, so a lease missing meanwhile cannot be
 * overwritten.
 */
async function ownedTransition(
  runId: string,
  owner: AttemptOwner,
  state: TrainingRun["state"],
  db: Executor,
): Promise<TrainingRun> {
  const [row] = await db
    .update(trainingRuns)
    .set(stateColumns(state))
    .where(
      and(
        eq(trainingRuns.id, runId),
        eq(trainingRuns.status, "running"),
        eq(trainingRuns.workerId, owner.workerId),
        eq(trainingRuns.sessionId, owner.sessionId),
        eq(trainingRuns.attempt, owner.attempt),
        gt(trainingRuns.leaseExpiresAt, new Date()),
        sessionIsCurrent(owner),
      ),
    )
    .returning();
  if (!row) {
    throw new TrainingRunConflictError(
      `Training run ${runId} is not owned by ${owner.workerId}/${owner.sessionId}`,
    );
  }
  return toRun(row);
}

function leaseUntil(at: Date): Date {
  return new Date(at.getTime() + LEASE_MILLISECONDS);
}

function leaseFrom(at: Date): string {
  return leaseUntil(at).toISOString();
}

export async function readTrainingRun(
  runId: string,
  db?: Executor,
): Promise<TrainingRun | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(trainingRuns)
    .where(eq(trainingRuns.id, runId));
  return row ? toRun(row) : null;
}

/**
 * Whether a run's worker still holds it at `at`, judged as a claim judges
 * it; a run nobody runs is held by no one.
 */
export async function trainingLeaseHeld(
  runId: string,
  at: Date,
): Promise<boolean> {
  const [row] = await (
    await database()
  )
    .select({ held: leaseIsHeld(trainingRuns, at) })
    .from(trainingRuns)
    .where(eq(trainingRuns.id, runId));
  return row?.held === true;
}

/** The newest runs, of one training set or of every set training one model. */
export async function listTrainingRunSummaries(
  of: { datasetId: string } | { modelId: string },
  limit = TRAINING_RUN_LIST_LIMIT,
): Promise<TrainingRunSummary[]> {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > TRAINING_RUN_LIST_LIMIT
  ) {
    throw new Error(
      `Training run list limit must be between 1 and ${TRAINING_RUN_LIST_LIMIT}`,
    );
  }
  const db = await database();
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
    .limit(limit);
  return rows.map((row) => ({
    dataset: row.dataset,
    run: toRun(row.run),
    completed: row.completed,
    best:
      row.bestMap50 == null || row.bestMap50To95 == null
        ? null
        : { map50: row.bestMap50, map50To95: row.bestMap50To95 },
  }));
}

export async function latestTrainingRun(
  datasetId: string,
): Promise<TrainingRun | null> {
  const db = await database();
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
  return row ? toRun(row.run) : null;
}

export async function activeTrainingRun(
  modelId: string,
  db?: Executor,
): Promise<TrainingRun | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(trainingRuns)
    .where(
      and(
        eq(trainingRuns.modelId, modelId),
        inArray(trainingRuns.status, [...ACTIVE_TRAINING_RUN_STATUSES]),
      ),
    );
  return row ? toRun(row) : null;
}

export async function createTrainingRun(
  datasetId: string,
  recipe: TrainingRecipe,
  targetWorkerId: string | null = null,
): Promise<TrainingRun> {
  await validateTrainingTarget(targetWorkerId);
  return transaction(async (tx) => {
    const dataset = await readDataset(datasetId, tx);
    if (!dataset)
      throw new DatasetNotFoundError(`Unknown dataset: ${datasetId}`);
    const active = await activeTrainingRun(dataset.modelId, tx);
    if (active) {
      throw new TrainingRunConflictError(
        `Training run ${active.id} is still active for ${dataset.modelId}`,
      );
    }
    const snapshot = await createDatasetSnapshot(datasetId, tx);
    const [row] = await tx
      .insert(trainingRuns)
      .values({
        id: trainingRunId(randomUUID()),
        modelId: snapshot.modelId,
        datasetSnapshotId: snapshot.id,
        createdAt: new Date(),
        attempt: 0,
        targetWorkerId,
        recipe: trainingRecipeSchema.parse(recipe),
        ...stateColumns({ status: "queued" }),
      })
      .returning();
    return requireTrainingRunRow(row, snapshot.id);
  });
}

/**
 * Leases the oldest claimable run to a worker session. A live session gets its
 * run back idempotently; a run whose lease no longer holds starts a fresh
 * attempt under whichever session claims it first.
 */
export async function claimTrainingRun(
  owner: WorkerIdentity,
  at: Date = new Date(),
): Promise<TrainingRun | null> {
  return transaction(async (tx) => {
    const worker = await lockWorkerSession(owner, tx);
    if (!canTrain(worker)) return null;
    const [inference] = await tx
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
    const [owned] = await tx
      .select()
      .from(trainingRuns)
      .where(
        and(
          eq(trainingRuns.status, "running"),
          eq(trainingRuns.workerId, owner.workerId),
          eq(trainingRuns.sessionId, owner.sessionId),
          gt(trainingRuns.leaseExpiresAt, at),
        ),
      );
    if (owned) return toRun(owned);
    const [candidate] = await tx
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
      await finishAttempt(toRun(candidate), "expired", tx);
    await tx.insert(trainingAttempts).values({
      runId: candidate.id,
      attempt: candidate.attempt + 1,
      workerId: owner.workerId,
      startedAt: at,
    });
    const [row] = await tx
      .update(trainingRuns)
      .set({
        attempt: candidate.attempt + 1,
        targetWorkerId: owner.workerId,
        lastProgressAt: at,
        ...stateColumns({
          status: "running",
          workerId: owner.workerId,
          sessionId: owner.sessionId,
          leaseExpiresAt: leaseFrom(at),
          phase: "preparing",
          progress: 0,
        }),
      })
      .where(eq(trainingRuns.id, candidate.id))
      .returning();
    return requireTrainingRunRow(row, candidate.id);
  });
}

/** The run as its leaseholder sees it; any other caller gets a conflict. */
export async function lockOwnedTrainingRun(
  runId: string,
  owner: AttemptOwner,
  db: Executor,
): Promise<RunningTrainingRun> {
  const [row] = await db
    .select()
    .from(trainingRuns)
    .where(eq(trainingRuns.id, runId))
    .for("update");
  return requireOwnedRunningRun(runId, row ? toRun(row) : null, owner, db);
}

export async function requireOwnedRunningRun(
  runId: string,
  run: TrainingRun | null,
  owner: AttemptOwner,
  db: Executor,
): Promise<RunningTrainingRun> {
  await currentWorkerSession(owner, db);
  if (
    run?.state.status !== "running" ||
    run.state.workerId !== owner.workerId ||
    run.state.sessionId !== owner.sessionId ||
    run.attempt !== owner.attempt ||
    new Date(run.state.leaseExpiresAt) <= new Date()
  ) {
    throw new TrainingRunConflictError(
      `Training run ${runId} is not owned by ${owner.workerId}/${owner.sessionId}`,
    );
  }
  return run as RunningTrainingRun;
}

/** Renew ownership without changing the run's phase or business progress. */
export async function renewTrainingLease(
  runId: string,
  owner: AttemptOwner,
  at: Date = new Date(),
): Promise<TrainingRun> {
  const db = await database();
  const [row] = await db
    .update(trainingRuns)
    .set({ leaseExpiresAt: leaseUntil(at) })
    .where(
      and(
        eq(trainingRuns.id, runId),
        eq(trainingRuns.status, "running"),
        eq(trainingRuns.workerId, owner.workerId),
        eq(trainingRuns.sessionId, owner.sessionId),
        eq(trainingRuns.attempt, owner.attempt),
        gt(trainingRuns.leaseExpiresAt, new Date()),
        sessionIsCurrent(owner),
      ),
    )
    .returning();
  if (!row) {
    throw new TrainingRunConflictError(
      `Training run ${runId} is not owned by ${owner.workerId}/${owner.sessionId}`,
    );
  }
  return toRun(row);
}

/** Advance through the ordered execution phases; retries are idempotent. */
export async function enterTrainingPhase(
  runId: string,
  owner: AttemptOwner,
  phase: TrainingPhase,
  at: Date = new Date(),
): Promise<TrainingRun> {
  return transaction(async (db) => {
    const current = await lockOwnedTrainingRun(runId, owner, db);
    if (
      phase !== current.state.phase &&
      phase !== NEXT_PHASE[current.state.phase]
    ) {
      throw new TrainingRunConflictError(
        `Training run ${runId} cannot move from ${current.state.phase} to ${phase}`,
      );
    }
    if (phase !== current.state.phase)
      await db
        .update(trainingRuns)
        .set({ lastProgressAt: at })
        .where(eq(trainingRuns.id, runId));
    return ownedTransition(
      runId,
      owner,
      {
        status: "running",
        workerId: owner.workerId,
        sessionId: owner.sessionId,
        leaseExpiresAt: leaseFrom(at),
        phase,
        progress: Math.max(current.state.progress, PHASE_PROGRESS[phase]),
      },
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
  owner: AttemptOwner,
  report: TrainingEpochReport,
  at: Date = new Date(),
): Promise<TrainingRun> {
  return transaction(async (tx) => {
    const current = await lockOwnedTrainingRun(runId, owner, tx);
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
    const [previous] = await tx
      .select({ epoch: trainingEpochs.epoch })
      .from(trainingEpochs)
      .where(
        and(
          eq(trainingEpochs.runId, runId),
          eq(trainingEpochs.attempt, owner.attempt),
        ),
      )
      .orderBy(desc(trainingEpochs.epoch))
      .limit(1);
    if (!previous || report.epoch > previous.epoch)
      await tx
        .update(trainingRuns)
        .set({
          lastProgressAt: at,
          checkpoint:
            current.checkpoint && report.epoch < current.checkpoint.epoch
              ? current.checkpoint
              : {
                  attempt: owner.attempt,
                  epoch: report.epoch,
                  workerId: owner.workerId,
                },
        })
        .where(eq(trainingRuns.id, runId));
    await tx
      .insert(trainingEpochs)
      .values({
        runId,
        attempt: current.attempt,
        epoch: report.epoch,
        recordedAt: at,
        trainBoxLoss: report.train.box,
        trainClassificationLoss: report.train.classification,
        trainRegressionLoss: report.train.regression,
        valBoxLoss: report.val.box,
        valClassificationLoss: report.val.classification,
        valRegressionLoss: report.val.regression,
        precision: report.precision,
        recall: report.recall,
        map50: report.map50,
        map50To95: report.map50To95,
        fitness: report.fitness,
        learningRate: report.learningRate,
      })
      .onConflictDoUpdate({
        target: [
          trainingEpochs.runId,
          trainingEpochs.attempt,
          trainingEpochs.epoch,
        ],
        set: {
          recordedAt: at,
          trainBoxLoss: report.train.box,
          trainClassificationLoss: report.train.classification,
          trainRegressionLoss: report.train.regression,
          valBoxLoss: report.val.box,
          valClassificationLoss: report.val.classification,
          valRegressionLoss: report.val.regression,
          precision: report.precision,
          recall: report.recall,
          map50: report.map50,
          map50To95: report.map50To95,
          fitness: report.fitness,
          learningRate: report.learningRate,
        },
      });
    return ownedTransition(
      runId,
      owner,
      {
        status: "running",
        workerId: owner.workerId,
        sessionId: owner.sessionId,
        leaseExpiresAt: leaseFrom(at),
        phase: "training",
        progress: Math.max(
          current.state.progress,
          PHASE_PROGRESS.training +
            TRAINING_PROGRESS_RANGE * (report.epoch / total),
        ),
      },
      tx,
    );
  });
}

/**
 * The run's curve: the epochs of its current attempt. An attempt that resumes
 * reports again the epochs it carries forward; an abandoned attempt's are not
 * the run's.
 */
export async function listTrainingEpochs(
  runId: string,
): Promise<TrainingEpoch[]> {
  const db = await database();
  const rows = await db
    .select({ epoch: trainingEpochs })
    .from(trainingEpochs)
    .innerJoin(
      trainingRuns,
      and(
        eq(trainingRuns.id, trainingEpochs.runId),
        eq(trainingRuns.attempt, trainingEpochs.attempt),
      ),
    )
    .where(eq(trainingEpochs.runId, runId))
    .orderBy(asc(trainingEpochs.epoch));
  return rows.map(({ epoch }) => toEpoch(epoch));
}

export async function failTrainingRun(
  runId: string,
  owner: AttemptOwner,
  error: string,
): Promise<TrainingRun> {
  return transaction(async (tx) => {
    await lockOwnedTrainingRun(runId, owner, tx);
    return transitionTrainingRun(
      runId,
      { status: "failed", error: error.slice(0, 2000) },
      tx,
    );
  });
}

export async function snapshotForRun(runId: string, owner: AttemptOwner) {
  const db = await database();
  const run = await requireOwnedRunningRun(
    runId,
    await readTrainingRun(runId, db),
    owner,
    db,
  );
  const snapshot = await readDatasetSnapshot(run.datasetSnapshotId, db);
  if (!snapshot) throw new Error(`Missing snapshot ${run.datasetSnapshotId}`);
  return snapshot;
}
