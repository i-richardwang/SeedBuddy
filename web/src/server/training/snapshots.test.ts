import { expect, test } from "bun:test";

import {
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../domain/training/errors";
import { recipe, trainer, trainingDataset } from "../testing/training";
import { controlTrainingRun } from "./control";
import { createTrainingRun } from "./runs";
import { snapshotForRun } from "./snapshots";

test("snapshot access distinguishes a missing run from a run the worker does not own", async () => {
  const owner = await trainer("snapshot-access-worker");
  await expect(
    snapshotForRun("missing-snapshot-run", owner),
  ).rejects.toBeInstanceOf(TrainingRunNotFoundError);
  const dataset = await trainingDataset("snapshot-access-dataset");
  const run = await createTrainingRun(dataset.id, recipe, owner.workerId);
  try {
    await expect(snapshotForRun(run.id, owner)).rejects.toBeInstanceOf(
      TrainingRunConflictError,
    );
  } finally {
    await controlTrainingRun(dataset.id, run.id, run.attempt, {
      action: "cancel",
    });
  }
});
