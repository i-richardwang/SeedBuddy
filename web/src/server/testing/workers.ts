import type { RuntimeDescriptor } from "../../domain/inference/schema";
import type {
  Worker,
  WorkerHeartbeat,
  WorkerIdentity,
} from "../../domain/workers/schema";
import { database, operationTime } from "../infra/db/client";
import { workers } from "../infra/db/schema";
import { recordWorkerHeartbeat } from "../workers/sessions";

export const TEST_RUNTIME: RuntimeDescriptor = {
  adapter: "traditional",
  fingerprint: "b".repeat(64),
};

export const ULTRALYTICS_RUNTIME: RuntimeDescriptor = {
  adapter: "ultralytics",
  fingerprint: "e".repeat(64),
};

/** A heartbeat from a worker that executes only `TEST_RUNTIME`. */
export function testHeartbeat(workerId: string): WorkerHeartbeat {
  return {
    workerId,
    sessionId: `session-${workerId}`,
    startedAt: "2026-08-27T00:00:00.000Z",
    runtimes: [TEST_RUNTIME],
    memoryBytes: 8 * 1024 ** 3,
  };
}

/**
 * A heartbeat from a worker the test enrolled, enrolling it on first use as an
 * administrator would.
 */
export async function recordTestHeartbeat(
  heartbeat: WorkerHeartbeat,
  at?: Date,
): Promise<Worker> {
  const db = await database();
  await db
    .insert(workers)
    .values({
      id: heartbeat.workerId,
      tokenHash: `test-${heartbeat.workerId}`,
      enrolledAt: await operationTime(db, at),
    })
    .onConflictDoNothing();
  return recordWorkerHeartbeat(heartbeat, at);
}

export function trainingHeartbeat(
  identity: WorkerIdentity,
  startedAt: Date,
): WorkerHeartbeat {
  return {
    workerId: identity.workerId,
    sessionId: identity.sessionId,
    startedAt: startedAt.toISOString(),
    runtimes: [ULTRALYTICS_RUNTIME],
    memoryBytes: 24 * 1024 ** 3,
  };
}

export const ultralyticsWorker: Worker = {
  ...trainingHeartbeat(
    { workerId: "ultralytics-worker", sessionId: "session-ultralytics-worker" },
    new Date("2026-08-27T00:00:00.000Z"),
  ),
  lastSeenAt: "2026-08-27T00:00:00.000Z",
};
