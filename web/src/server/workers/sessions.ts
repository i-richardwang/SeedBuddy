import { WorkerSessionConflictError } from "../../domain/workers/errors";
import { and, desc, eq, gt, lt, or, sql, type SQLWrapper } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { database, type Executor } from "../infra/db/client";
import { workerSessions } from "../infra/db/schema";
import {
  canTrain,
  workerSchema,
  type Worker,
  type WorkerHeartbeat,
  type WorkerIdentity,
} from "../../domain/workers/schema";
import { workerPresence } from "../../domain/workers/presence";

function toWorker(row: typeof workerSessions.$inferSelect): Worker {
  return workerSchema.parse({
    workerId: row.workerId,
    sessionId: row.sessionId,
    startedAt: row.startedAt.toISOString(),
    runtimes: row.runtimes,
    memoryBytes: row.memoryBytes,
    lastSeenAt: row.lastSeenAt.toISOString(),
  });
}

/**
 * A worker heartbeats while polling for work and while it holds a lease;
 * presence is derived from the heartbeat age. A worker runs one process at a
 * time: a newer session replaces an older one, and an older session that
 * heartbeats afterwards is refused.
 */
export async function recordWorkerHeartbeat(
  heartbeat: WorkerHeartbeat,
  at: Date = new Date(),
): Promise<Worker> {
  const worker = workerSchema.parse({
    ...heartbeat,
    lastSeenAt: at.toISOString(),
  });
  const row = {
    sessionId: worker.sessionId,
    startedAt: new Date(worker.startedAt),
    runtimes: worker.runtimes,
    memoryBytes: worker.memoryBytes,
    lastSeenAt: at,
  };
  const [stored] = await (
    await database()
  )
    .insert(workerSessions)
    .values({ workerId: worker.workerId, ...row })
    .onConflictDoUpdate({
      target: workerSessions.workerId,
      set: row,
      setWhere: or(
        eq(workerSessions.sessionId, worker.sessionId),
        lt(workerSessions.startedAt, new Date(worker.startedAt)),
      ),
    })
    .returning();
  if (!stored) {
    throw new WorkerSessionConflictError(
      `Worker ${worker.workerId} has a newer active session`,
    );
  }
  return toWorker(stored);
}

function sessionRow(identity: WorkerIdentity, db: Executor) {
  return db
    .select()
    .from(workerSessions)
    .where(
      and(
        eq(workerSessions.workerId, identity.workerId),
        eq(workerSessions.sessionId, identity.sessionId),
      ),
    );
}

function sessionOf(
  identity: WorkerIdentity,
  row: typeof workerSessions.$inferSelect | undefined,
): Worker {
  if (!row) {
    throw new WorkerSessionConflictError(
      `Worker ${identity.workerId} must heartbeat as ${identity.sessionId} before owning work`,
    );
  }
  return toWorker(row);
}

/**
 * The worker as its current session, or a conflict when the roster holds no
 * such session: a process must heartbeat before it can own work.
 */
export async function currentWorkerSession(
  identity: WorkerIdentity,
  db?: Executor,
): Promise<Worker> {
  const [row] = await sessionRow(identity, db ?? (await database()));
  return sessionOf(identity, row);
}

/** The current session with its row locked, so one worker claims one job at a time. */
export async function lockWorkerSession(
  identity: WorkerIdentity,
  tx: Executor,
): Promise<Worker> {
  const [row] = await sessionRow(identity, tx).for("update");
  return sessionOf(identity, row);
}

/** A session named by values, or by the columns of a row that holds work. */
interface SessionRef {
  workerId: string | SQLWrapper;
  sessionId: string | SQLWrapper;
}

/**
 * A session is a fencing token: a predicate that holds only while the roster
 * still names it, so a write from a replaced process never lands. A session
 * ends when a newer process of its worker heartbeats or the worker is
 * removed.
 */
export function sessionIsCurrent(session: SessionRef) {
  return sql`exists (
    select 1 from ${workerSessions}
    where ${workerSessions.workerId} = ${session.workerId}
      and ${workerSessions.sessionId} = ${session.sessionId}
  )`;
}

/**
 * A lease holds while it is unexpired and its session is still current.
 * Work whose lease no longer holds is free for any session to take.
 */
export function leaseIsHeld(
  lease: SessionRef & { leaseExpiresAt: AnyPgColumn },
  at: Date,
) {
  return sql<boolean>`(${gt(lease.leaseExpiresAt, at)} and ${sessionIsCurrent(lease)})`;
}

/** The latest session of every worker that has connected, newest first. */
export async function listWorkers(): Promise<Worker[]> {
  const rows = await (
    await database()
  )
    .select()
    .from(workerSessions)
    .orderBy(desc(workerSessions.lastSeenAt));
  return rows.map(toWorker);
}

/** Workers online now that could take a training run. */
export async function listOnlineTrainers(
  at: Date = new Date(),
): Promise<Worker[]> {
  return (await listWorkers()).filter(
    (worker) =>
      canTrain(worker) && workerPresence(worker.lastSeenAt, at) === "online",
  );
}
