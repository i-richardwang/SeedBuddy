import { expect, test } from "bun:test";

import { WorkerSessionConflictError } from "../../domain/workers/errors";
import {
  WORKER_ONLINE_SECONDS,
  WORKER_STALE_SECONDS,
  workerPresence,
} from "../../domain/workers/presence";
import { database } from "../infra/db/client";
import { recordTestHeartbeat, testHeartbeat } from "../testing/workers";
import { currentWorkerSession } from "./sessions";

function later(from: Date, seconds: number): Date {
  return new Date(from.getTime() + seconds * 1000);
}

test("presence follows the age of the last heartbeat", async () => {
  const seen = new Date("2026-01-01T00:10:00.000Z");
  const worker = await recordTestHeartbeat(
    testHeartbeat("presence-worker"),
    seen,
  );
  expect(worker.lastSeenAt).toBe(seen.toISOString());
  const presence = (seconds: number) =>
    workerPresence(worker.lastSeenAt, later(seen, seconds));
  expect(presence(WORKER_ONLINE_SECONDS)).toBe("online");
  expect(presence(WORKER_ONLINE_SECONDS + 1)).toBe("stale");
  expect(presence(WORKER_STALE_SECONDS + 1)).toBe("offline");
});

test("an older session cannot replace a newer process with the same worker id", async () => {
  const heartbeat = {
    ...testHeartbeat("restarted-worker"),
    startedAt: "2026-01-01T00:00:00+00:00",
  };
  const newer = {
    ...heartbeat,
    sessionId: "newer-session",
    startedAt: "2026-01-02T00:00:00+00:00",
  };
  await recordTestHeartbeat(newer);
  await expect(recordTestHeartbeat(heartbeat)).rejects.toBeInstanceOf(
    WorkerSessionConflictError,
  );
  await expect(
    currentWorkerSession(heartbeat, await database()),
  ).rejects.toBeInstanceOf(WorkerSessionConflictError);
  expect((await currentWorkerSession(newer, await database())).sessionId).toBe(
    "newer-session",
  );
});
