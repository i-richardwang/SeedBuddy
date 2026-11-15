import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  WorkerNameTakenError,
  WorkerNotFoundError,
  WorkerSessionConflictError,
} from "../../domain/workers/errors";
import { database } from "../infra/db/client";
import { users } from "../infra/db/schema";
import { signInAs } from "../testing/auth";
import { testHeartbeat } from "../testing/workers";
import {
  authenticateWorker,
  enrollWorker,
  listEnrolledWorkers,
  removePersonalWorker,
  removeWorker,
} from "./enrollment";
import {
  currentWorkerSession,
  listWorkers,
  recordWorkerHeartbeat,
} from "./sessions";

test("an enrolled worker's token proves which worker it is, until it is removed", async () => {
  const { workerId, token } = await enrollWorker("enrolled-bench", null);
  expect(workerId).toBe("enrolled-bench");
  expect(await authenticateWorker(token)).toEqual({
    workerId: "enrolled-bench",
    suspended: false,
  });
  expect(await authenticateWorker(`${token}x`)).toBeNull();
  expect(await authenticateWorker("not-a-worker-token")).toBeNull();
  expect(await listEnrolledWorkers(await database())).toContainEqual({
    workerId: "enrolled-bench",
    owner: null,
  });

  const heartbeat = testHeartbeat("enrolled-bench");
  await recordWorkerHeartbeat(heartbeat);
  expect(
    (await currentWorkerSession(heartbeat, await database())).workerId,
  ).toBe("enrolled-bench");

  await removeWorker("enrolled-bench");
  expect(await authenticateWorker(token)).toBeNull();
  await expect(
    currentWorkerSession(heartbeat, await database()),
  ).rejects.toBeInstanceOf(WorkerSessionConflictError);
  expect(
    (await listWorkers(await database())).map((worker) => worker.workerId),
  ).not.toContain("enrolled-bench");
  await expect(removeWorker("enrolled-bench")).rejects.toBeInstanceOf(
    WorkerNotFoundError,
  );
});

test("a name is enrolled once", async () => {
  await enrollWorker("named-once", null);
  await expect(enrollWorker("named-once", null)).rejects.toBeInstanceOf(
    WorkerNameTakenError,
  );
});

test("a machine that is not enrolled cannot heartbeat", async () => {
  await expect(
    recordWorkerHeartbeat(testHeartbeat("never-enrolled")),
  ).rejects.toThrow();
});

test("a personal worker belongs to the account that enrolled it, which removes its own and no other", async () => {
  const { user: owner } = await signInAs("member");
  const { user: other } = await signInAs("member");
  await enrollWorker("owned-laptop", owner.id);
  expect(await listEnrolledWorkers(await database())).toContainEqual({
    workerId: "owned-laptop",
    owner: { id: owner.id, name: owner.name },
  });

  await enrollWorker("shared-bench", null);
  for (const [user, workerId] of [
    [other.id, "owned-laptop"],
    [owner.id, "shared-bench"],
  ] as const)
    await expect(removePersonalWorker(user, workerId)).rejects.toBeInstanceOf(
      WorkerNotFoundError,
    );
  await removePersonalWorker(owner.id, "owned-laptop");
  await removeWorker("shared-bench");
  expect(
    (await listEnrolledWorkers(await database())).map(
      (worker) => worker.workerId,
    ),
  ).not.toContain("owned-laptop");
});

test("a personal worker's token says when its owner's account is suspended, and goes with the account", async () => {
  const { user: owner } = await signInAs("member");
  const { token } = await enrollWorker("standing-laptop", owner.id);
  const db = await database();
  const suspend = (banned: boolean) =>
    db.update(users).set({ banned }).where(eq(users.id, owner.id));
  const proven = (suspended: boolean) => ({
    workerId: "standing-laptop",
    suspended,
  });
  expect(await authenticateWorker(token)).toEqual(proven(false));

  await suspend(true);
  expect(await authenticateWorker(token)).toEqual(proven(true));
  await suspend(false);
  expect(await authenticateWorker(token)).toEqual(proven(false));

  await db.delete(users).where(eq(users.id, owner.id));
  expect(await authenticateWorker(token)).toBeNull();
  expect(
    (await listEnrolledWorkers(db)).map((worker) => worker.workerId),
  ).not.toContain("standing-laptop");
});
