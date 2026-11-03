import { expect, test } from "bun:test";

import { YOLO26N_WHOLE_RECIPE } from "../../domain/training/recipes";
import { reviewedDataset } from "../testing/datasets";
import { traditionalVersion } from "../testing/models";
import {
  recordTestHeartbeat,
  testHeartbeat,
  ULTRALYTICS_RUNTIME,
} from "../testing/workers";
import { controlTrainingRun } from "../training/control";
import {
  claimTrainingRun,
  createTrainingRun,
  renewTrainingLease,
} from "../training/runs";
import { trainingRunDetail } from "./training-run-detail";

test("a run's detail judges whether it has stalled as of its reading", async () => {
  const { dataset } = await reviewedDataset(
    "stalling",
    ["stalling-a", "stalling-b"],
    await traditionalVersion("stalling-detector", "stalling-v1"),
  );
  const run = await createTrainingRun(dataset.id, YOLO26N_WHOLE_RECIPE);
  const heartbeat = {
    ...testHeartbeat("stalling-trainer"),
    runtimes: [ULTRALYTICS_RUNTIME],
    memoryBytes: 24 * 1024 ** 3,
  };
  const worker = await recordTestHeartbeat(heartbeat);
  const start = new Date();
  const after = (minutes: number) =>
    new Date(start.getTime() + minutes * 60_000);
  expect((await claimTrainingRun(worker, start))?.id).toBe(run.id);

  const stall = async (at: Date) =>
    (await trainingRunDetail(dataset.id, run.id, at))?.stall;
  expect(await stall(after(1))).toBeNull();
  expect(await stall(after(16))).toBe("worker-lost");
  await renewTrainingLease(run.id, { ...worker, attempt: 1 }, after(14));
  expect(await stall(after(16))).toBe("no-progress");

  await recordTestHeartbeat(
    {
      ...heartbeat,
      sessionId: "session-stalling-trainer-restarted",
      startedAt: "2026-08-27T01:00:00.000Z",
    },
    after(17),
  );
  expect(await stall(after(17))).toBe("worker-lost");

  await controlTrainingRun(dataset.id, run.id, 1, { action: "cancel" });
  expect(await stall(after(16))).toBeNull();
});

test("a paused run names the run of its model it waits for", async () => {
  const { dataset } = await reviewedDataset(
    "waiting",
    ["waiting-a", "waiting-b"],
    await traditionalVersion("waiting-detector", "waiting-v1"),
  );
  const paused = await createTrainingRun(dataset.id, YOLO26N_WHOLE_RECIPE);
  await controlTrainingRun(dataset.id, paused.id, 0, { action: "pause" });
  const blockedBy = async () =>
    (await trainingRunDetail(dataset.id, paused.id))?.blockedBy;
  expect(await blockedBy()).toBeNull();

  const active = await createTrainingRun(dataset.id, YOLO26N_WHOLE_RECIPE);
  expect(await blockedBy()).toEqual({
    runId: active.id,
    datasetId: dataset.id,
  });
  expect(
    (await trainingRunDetail(dataset.id, active.id))?.blockedBy,
  ).toBeNull();

  await controlTrainingRun(dataset.id, active.id, 0, { action: "cancel" });
  expect(await blockedBy()).toBeNull();
});
