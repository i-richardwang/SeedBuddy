import { createHash, randomBytes } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import {
  WorkerAlreadyEnrolledError,
  WorkerNotFoundError,
} from "../../domain/workers/errors";
import type { EnrolledWorker } from "../../domain/workers/schema";
import { database } from "../infra/db/client";
import { workers } from "../infra/db/schema";

const TOKEN_PREFIX = "vfw_";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * An administrator enrolls a machine under a name and hands it the token
 * returned here. The token is the worker's identity on every request, and
 * only its hash is kept.
 */
export async function enrollWorker(workerId: string): Promise<EnrolledWorker> {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [enrolled] = await (
    await database()
  )
    .insert(workers)
    .values({
      id: workerId,
      tokenHash: tokenHash(token),
      enrolledAt: new Date(),
    })
    .onConflictDoNothing({ target: workers.id })
    .returning({ id: workers.id });
  if (!enrolled) {
    throw new WorkerAlreadyEnrolledError(
      `A worker named ${workerId} is already enrolled`,
    );
  }
  return { workerId, token };
}

/**
 * Removing a worker revokes its token and ends its session, so the work it
 * holds loses its lease and its pending writes are fenced off. Local training
 * recovery remains bound to that worker until explicitly restarted.
 */
export async function removeWorker(workerId: string): Promise<void> {
  const [removed] = await (
    await database()
  )
    .delete(workers)
    .where(eq(workers.id, workerId))
    .returning({ id: workers.id });
  if (!removed) throw new WorkerNotFoundError(`No worker named ${workerId}`);
}

/** The enrolled worker a token belongs to, or null for any other string. */
export async function authenticateWorker(
  token: string,
): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [worker] = await (
    await database()
  )
    .select({ id: workers.id })
    .from(workers)
    .where(eq(workers.tokenHash, tokenHash(token)));
  return worker?.id ?? null;
}

/** The names of the enrolled workers, in the order they were enrolled. */
export async function listEnrolledWorkers(): Promise<string[]> {
  const rows = await (
    await database()
  )
    .select({ id: workers.id })
    .from(workers)
    .orderBy(asc(workers.enrolledAt), asc(workers.id));
  return rows.map((row) => row.id);
}
