import { WorkerSessionConflictError } from "../../domain/workers/errors";
import { expect, test } from "bun:test";

import {
  WORKER_ONLINE_SECONDS,
  WORKER_STALE_SECONDS,
  workerPresence,
} from "../../domain/workers/presence";
import {
  TEST_RUNTIME,
  ULTRALYTICS_RUNTIME,
  recordTestHeartbeat,
  testHeartbeat,
} from "../testing/fixtures";
import { currentWorkerSession, listOnlineTrainers } from "./sessions";

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

test("a worker trains only with the ultralytics runtime", async () => {
  const seen = new Date("2026-02-01T00:00:00.000Z");
  await recordTestHeartbeat(testHeartbeat("detector-only"), seen);
  await recordTestHeartbeat(
    {
      ...testHeartbeat("trainer"),
      runtimes: [TEST_RUNTIME, ULTRALYTICS_RUNTIME],
    },
    seen,
  );
  const trainers = (await listOnlineTrainers(seen)).map(
    (worker) => worker.workerId,
  );
  expect(trainers).toContain("trainer");
  expect(trainers).not.toContain("detector-only");
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
  await expect(currentWorkerSession(heartbeat)).rejects.toBeInstanceOf(
    WorkerSessionConflictError,
  );
  expect((await currentWorkerSession(newer)).sessionId).toBe("newer-session");
});
