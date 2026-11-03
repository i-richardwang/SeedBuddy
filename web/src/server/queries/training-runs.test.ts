import { expect, test } from "bun:test";

import {
  claimTrainingRun,
  createTrainingRun,
  enterTrainingPhase,
  failTrainingRun,
  recordTrainingEpoch,
} from "../training/runs";
import {
  epochReport,
  recipe,
  reviewedDataset,
  trainer,
} from "../training/testing";
import { listTrainingRunOverviews } from "./training-runs";

test("training overviews list the dataset's runs and bound the requested page", async () => {
  const dataset = await reviewedDataset("overview-runs");
  const owner = await trainer("listing-trainer");
  const first = await createTrainingRun(dataset.id, recipe, owner.workerId);
  expect((await claimTrainingRun(owner))?.id).toBe(first.id);
  await failTrainingRun(first.id, owner, "stopped");
  const next = await createTrainingRun(dataset.id, recipe, owner.workerId);
  expect((await claimTrainingRun(owner))?.id).toBe(next.id);
  await failTrainingRun(next.id, owner, "stopped");
  expect(
    (await listTrainingRunOverviews({ datasetId: dataset.id }))
      .map(({ run }) => run.id)
      .sort(),
  ).toEqual([first.id, next.id].sort());
  await expect(
    listTrainingRunOverviews({ datasetId: dataset.id }, 101),
  ).rejects.toThrow(/between 1 and 100/);
});

test("training overviews count epochs and select metrics only from the current attempt", async () => {
  const dataset = await reviewedDataset("overview-epochs");
  const owner = await trainer("listing-epoch-trainer");
  const run = await createTrainingRun(dataset.id, recipe, owner.workerId);
  const start = new Date();
  expect((await claimTrainingRun(owner, start))?.id).toBe(run.id);
  await enterTrainingPhase(run.id, owner, "training", start);
  await recordTrainingEpoch(run.id, owner, epochReport(1), start);
  await recordTrainingEpoch(run.id, owner, epochReport(2), start);
  const expired = new Date(start.getTime() + 10 * 60 * 1000);
  const nextOwner = { ...owner, attempt: 2 };
  expect((await claimTrainingRun(nextOwner, expired))?.id).toBe(run.id);
  await enterTrainingPhase(run.id, nextOwner, "training", expired);
  await recordTrainingEpoch(run.id, nextOwner, epochReport(1), expired);
  expect(
    await listTrainingRunOverviews({ datasetId: dataset.id }, 1),
  ).toMatchObject([
    {
      dataset: { id: dataset.id, name: "overview-epochs" },
      run: { id: run.id },
      completed: 1,
      best: { map50: 0.3, map50To95: 0.1 },
    },
  ]);
  await failTrainingRun(run.id, nextOwner, "stopped");
});
