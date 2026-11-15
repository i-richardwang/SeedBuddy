import { expect, test } from "bun:test";

import { signInAs } from "../testing/auth";
import {
  recordTestHeartbeat,
  TEST_RUNTIME,
  testHeartbeat,
  ULTRALYTICS_RUNTIME,
} from "../testing/workers";
import { enrollWorker } from "../workers/public";
import { listTrainingWorkerOverviews } from "./list-training-worker-overviews";

const seen = new Date("2026-02-01T00:00:00.000Z");

function trains(workerId: string) {
  return {
    ...testHeartbeat(workerId),
    runtimes: [TEST_RUNTIME, ULTRALYTICS_RUNTIME],
  };
}

test("a worker trains only with the ultralytics runtime", async () => {
  await recordTestHeartbeat(testHeartbeat("detector-only"), seen);
  await recordTestHeartbeat(trains("trainer"), seen);
  const { user } = await signInAs("member");
  const trainers = await listTrainingWorkerOverviews(user.id, seen);
  expect(trainers).toContainEqual({
    workerId: "trainer",
    online: true,
    personal: false,
  });
  expect(trainers.map((worker) => worker.workerId)).not.toContain(
    "detector-only",
  );
});

test("a personal worker is offered only to the account it belongs to", async () => {
  const { user: owner } = await signInAs("member");
  const { user: other } = await signInAs("member");
  await enrollWorker("offered-laptop", owner.id);
  await recordTestHeartbeat(trains("offered-laptop"), seen);
  const offered = async (user: string) =>
    (await listTrainingWorkerOverviews(user, seen)).find(
      (worker) => worker.workerId === "offered-laptop",
    );

  expect(await offered(owner.id)).toEqual({
    workerId: "offered-laptop",
    online: true,
    personal: true,
  });
  expect(await offered(other.id)).toBeUndefined();
});
