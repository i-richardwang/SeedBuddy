import { expect, test } from "bun:test";

import { YOLO26N_WHOLE_RECIPE } from "../../domain/training/recipes";
import { signInAs } from "../testing/auth";
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
  renewTrainingRun,
} from "../training/runs";
import { trainingRunDetail } from "./training-run-detail";

/** The account that sends this file's runs and reads their pages. */
const account = (await signInAs("member")).user.id;

test("a run's detail judges whether it has stalled as of its reading", async () => {
  const { dataset } = await reviewedDataset(
    "stalling",
    ["stalling-a", "stalling-b"],
    await traditionalVersion("stalling-detector", "stalling-v1"),
  );
  const run = await createTrainingRun(
    dataset.id,
    YOLO26N_WHOLE_RECIPE,
    null,
    account,
  );
  const heartbeat = {
    ...testHeartbeat("stalling-trainer"),
    runtimes: [ULTRALYTICS_RUNTIME],
  };
  const worker = await recordTestHeartbeat(heartbeat);
  /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
  const start = new Date();
  const after = (minutes: number) =>
    new Date(start.getTime() + minutes * 60_000);
  expect((await claimTrainingRun(worker, start))?.id).toBe(run.id);

  const stall = async (at: Date) =>
    (await trainingRunDetail(dataset.id, run.id, account, at))?.stall;
  expect(await stall(after(1))).toBeNull();
  expect(await stall(after(16))).toBe("worker-lost");
  for (const minute of [4, 8, 12, 14])
    await renewTrainingRun(run.id, { ...worker, attempt: 1 }, after(minute));
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

  await controlTrainingRun(
    dataset.id,
    run.id,
    1,
    { action: "cancel" },
    account,
  );
  expect(await stall(after(16))).toBeNull();
});

test("a paused run names the run of its model it waits for", async () => {
  const { dataset } = await reviewedDataset(
    "waiting",
    ["waiting-a", "waiting-b"],
    await traditionalVersion("waiting-detector", "waiting-v1"),
  );
  const paused = await createTrainingRun(
    dataset.id,
    YOLO26N_WHOLE_RECIPE,
    null,
    account,
  );
  await controlTrainingRun(
    dataset.id,
    paused.id,
    0,
    { action: "pause" },
    account,
  );
  const blockedBy = async () =>
    (await trainingRunDetail(dataset.id, paused.id, account))?.blockedBy;
  expect(await blockedBy()).toBeNull();

  const active = await createTrainingRun(
    dataset.id,
    YOLO26N_WHOLE_RECIPE,
    null,
    account,
  );
  expect(await blockedBy()).toEqual({
    runId: active.id,
    datasetId: dataset.id,
  });
  expect(
    (await trainingRunDetail(dataset.id, active.id, account))?.blockedBy,
  ).toBeNull();

  await controlTrainingRun(
    dataset.id,
    active.id,
    0,
    { action: "cancel" },
    account,
  );
  expect(await blockedBy()).toBeNull();
});
