import { WorkerSessionConflictError } from "../../domain/workers/errors";
import { expect, test } from "bun:test";

import {
  WorkerAlreadyEnrolledError,
  WorkerNotFoundError,
} from "../../domain/workers/errors";
import { testHeartbeat } from "../testing/fixtures";
import {
  authenticateWorker,
  enrollWorker,
  listEnrolledWorkers,
  removeWorker,
} from "./enrollment";
import {
  currentWorkerSession,
  listWorkers,
  recordWorkerHeartbeat,
} from "./sessions";

test("an enrolled worker's token proves which worker it is, until it is removed", async () => {
  const { workerId, token } = await enrollWorker("enrolled-bench");
  expect(workerId).toBe("enrolled-bench");
  expect(await authenticateWorker(token)).toBe("enrolled-bench");
  expect(await authenticateWorker(`${token}x`)).toBeNull();
  expect(await authenticateWorker("not-a-worker-token")).toBeNull();
  expect(await listEnrolledWorkers()).toContain("enrolled-bench");

  const heartbeat = testHeartbeat("enrolled-bench");
  await recordWorkerHeartbeat(heartbeat);
  expect((await currentWorkerSession(heartbeat)).workerId).toBe(
    "enrolled-bench",
  );

  await removeWorker("enrolled-bench");
  expect(await authenticateWorker(token)).toBeNull();
  await expect(currentWorkerSession(heartbeat)).rejects.toBeInstanceOf(
    WorkerSessionConflictError,
  );
  expect((await listWorkers()).map((worker) => worker.workerId)).not.toContain(
    "enrolled-bench",
  );
  await expect(removeWorker("enrolled-bench")).rejects.toBeInstanceOf(
    WorkerNotFoundError,
  );
});

test("a name is enrolled once", async () => {
  await enrollWorker("named-once");
  await expect(enrollWorker("named-once")).rejects.toBeInstanceOf(
    WorkerAlreadyEnrolledError,
  );
});

test("a machine that is not enrolled cannot heartbeat", async () => {
  await expect(
    recordWorkerHeartbeat(testHeartbeat("never-enrolled")),
  ).rejects.toThrow();
});
