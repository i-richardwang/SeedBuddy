import { randomBytes } from "node:crypto";

import { and, asc, eq, type SQL } from "drizzle-orm";

import {
  WorkerNameTakenError,
  WorkerNotFoundError,
} from "../../domain/workers/errors";
import type {
  EnrolledWorker,
  WorkerOwnership,
} from "../../domain/workers/schema";
import {
  database,
  type Executor,
  operationTime,
  transaction,
} from "../infra/db/client";
import { refusingUnique } from "../infra/db/errors";
import { users, workers } from "../infra/db/schema";
import { contentDigest } from "../infra/digest";

const TOKEN_PREFIX = "vfw_";

/**
 * Enrolls a machine under a name and returns the token to hand it. The token
 * is the worker's identity on every request, and only its hash is kept.
 */
async function enroll(
  db: Executor,
  workerId: string,
  owner: string | null,
): Promise<EnrolledWorker> {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const at = await operationTime(db);
  await refusingUnique(
    "workers_pkey",
    () =>
      new WorkerNameTakenError(
        `A worker named ${workerId} is already enrolled`,
      ),
    () =>
      db.insert(workers).values({
        id: workerId,
        tokenHash: contentDigest(token),
        enrolledAt: at,
        ownerId: owner,
      }),
  );
  return { workerId, token };
}

/**
 * Enrolls a worker under a name nobody holds. A worker without an owner is
 * shared; one with an owner is that account's own computer.
 */
export async function enrollWorker(
  workerId: string,
  owner: string | null,
): Promise<EnrolledWorker> {
  return enroll(await database(), workerId, owner);
}

/**
 * Enrolls the user's own computer under a name it may have held before. A
 * personal worker the user already has under it gives way, which revokes its
 * token and ends its session, so a computer that lost its token takes its
 * name back. A name any other worker holds is taken.
 */
export async function reenrollPersonalWorker(
  user: string,
  workerId: string,
): Promise<EnrolledWorker> {
  return transaction(async (db) => {
    await db
      .delete(workers)
      .where(and(eq(workers.id, workerId), eq(workers.ownerId, user)));
    return enroll(db, workerId, user);
  });
}

/** Removes the named worker, provided it also meets `condition`. */
async function remove(workerId: string, condition?: SQL): Promise<void> {
  const [removed] = await (
    await database()
  )
    .delete(workers)
    .where(and(eq(workers.id, workerId), condition))
    .returning({ id: workers.id });
  if (!removed) throw new WorkerNotFoundError(`No worker named ${workerId}`);
}

/**
 * Removing a worker revokes its token and ends its session, so the work it
 * holds loses its lease and its pending writes are fenced off. Local training
 * recovery remains bound to that worker until explicitly restarted.
 */
export async function removeWorker(workerId: string): Promise<void> {
  await remove(workerId);
}

/** Removes a personal worker of the user's; anyone else's is not found. */
export async function removePersonalWorker(
  user: string,
  workerId: string,
): Promise<void> {
  await remove(workerId, eq(workers.ownerId, user));
}

/**
 * What a token proves: the enrolled worker it belongs to, and whether that
 * worker is a personal one whose owner's account is suspended; null for any
 * other string.
 */
export async function authenticateWorker(
  token: string,
): Promise<{ workerId: string; suspended: boolean } | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [worker] = await (
    await database()
  )
    .select({ workerId: workers.id, ownerBanned: users.banned })
    .from(workers)
    .leftJoin(users, eq(users.id, workers.ownerId))
    .where(eq(workers.tokenHash, contentDigest(token)));
  return worker
    ? { workerId: worker.workerId, suspended: worker.ownerBanned === true }
    : null;
}

/** The enrolled workers with their owners, in the order they were enrolled. */
export function listEnrolledWorkers(db: Executor): Promise<WorkerOwnership[]> {
  return db
    .select({
      workerId: workers.id,
      owner: { id: users.id, name: users.name },
    })
    .from(workers)
    .leftJoin(users, eq(users.id, workers.ownerId))
    .orderBy(asc(workers.enrolledAt), asc(workers.id));
}
