import { expect, test } from "bun:test";

import {
  epochReport,
  recipe,
  trainer,
  trainingDataset,
} from "../testing/training";
import {
  claimTrainingRun,
  createTrainingRun,
  enterTrainingPhase,
  failTrainingRun,
  recordTrainingEpoch,
} from "../training/runs";
import { listTrainingRunOverviews } from "./list-training-run-overviews";

test("training overviews list the dataset's runs and bound the requested page", async () => {
  const dataset = await trainingDataset("overview-runs");
  const owner = await trainer("listing-trainer");
  const first = await createTrainingRun(dataset.id, recipe, owner.workerId);
  expect((await claimTrainingRun(owner))?.id).toBe(first.id);
  await failTrainingRun(first.id, "stopped", owner);
  const next = await createTrainingRun(dataset.id, recipe, owner.workerId);
  expect((await claimTrainingRun(owner))?.id).toBe(next.id);
  await failTrainingRun(next.id, "stopped", owner);
  expect(
    (await listTrainingRunOverviews({ datasetId: dataset.id }))
      .map(({ run }) => run.id)
      .sort(),
  ).toEqual([first.id, next.id].sort());
});

test("training overviews count epochs and select metrics only from the current attempt", async () => {
  const dataset = await trainingDataset("overview-epochs");
  const owner = await trainer("listing-epoch-trainer");
  const run = await createTrainingRun(dataset.id, recipe, owner.workerId);
  /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
  const start = new Date();
  expect((await claimTrainingRun(owner, start))?.id).toBe(run.id);
  await enterTrainingPhase(run.id, "training", owner, start);
  await recordTrainingEpoch(run.id, epochReport(1), owner, start);
  await recordTrainingEpoch(run.id, epochReport(2), owner, start);
  const expired = new Date(start.getTime() + 10 * 60 * 1000);
  const nextOwner = { ...owner, attempt: 2 };
  expect((await claimTrainingRun(nextOwner, expired))?.id).toBe(run.id);
  await enterTrainingPhase(run.id, "training", nextOwner, expired);
  await recordTrainingEpoch(run.id, epochReport(1), nextOwner, expired);
  expect(
    await listTrainingRunOverviews({ datasetId: dataset.id }),
  ).toMatchObject([
    {
      dataset: { id: dataset.id, name: "overview-epochs" },
      run: { id: run.id },
      completed: 1,
      best: { map50: 0.3, map50To95: 0.1 },
    },
  ]);
  await failTrainingRun(run.id, "stopped", nextOwner);
});
