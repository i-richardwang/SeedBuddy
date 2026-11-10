import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { SEED_DETECTOR } from "../../domain/models/builtins";
import { DEFAULT_MODEL_ANNOTATION } from "../../domain/models/schema";
import {
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../domain/training/errors";
import { database } from "../infra/db/client";
import { models } from "../infra/db/schema";
import { requireModel, setModelSettings } from "../models/registry";
import { reviewedDataset } from "../testing/datasets";
import {
  analyzedWithDish,
  FIXTURE_COVERAGE,
  imageDigest,
} from "../testing/images";
import { traditionalVersion } from "../testing/models";
import { recipe, trainer, trainingDataset } from "../testing/training";
import { controlTrainingRun } from "./control";
import { createTrainingRun } from "./runs";
import {
  createDatasetSnapshot,
  readDatasetSnapshot,
  snapshotForRun,
} from "./snapshots";

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

test("a dish model's snapshot freezes each image's coverage, and keeps it when the model's area changes", async () => {
  const version = await traditionalVersion("dish-snapshot-detector", "dish-v1");
  const settings = {
    model: version.modelId,
    countedClasses: SEED_DETECTOR.classes,
    annotation: DEFAULT_MODEL_ANNOTATION,
  };
  await setModelSettings({ ...settings, area: "dish" });
  const { dataset } = await reviewedDataset(
    "dish-snapshot-dataset",
    ["dish-found", "dish-missing"],
    version,
  );
  const found = await imageDigest("dish-found");
  await analyzedWithDish(found);
  const db = await database();

  const framed = await createDatasetSnapshot(dataset.id, new Date(), db);
  expect(framed.area).toBe("dish");
  expect(
    Object.fromEntries(framed.images.map((i) => [i.digest, i.coverage])),
  ).toEqual({
    [found]: FIXTURE_COVERAGE,
    [await imageDigest("dish-missing")]: null,
  });
  expect(await createDatasetSnapshot(dataset.id, new Date(), db)).toEqual(
    framed,
  );

  await setModelSettings({ ...settings, area: "image" });
  expect(await readDatasetSnapshot(framed.id, db)).toEqual(framed);
  const whole = await createDatasetSnapshot(dataset.id, new Date(), db);
  expect(whole.id).not.toBe(framed.id);
  expect(whole.area).toBe("image");
  expect(whole.images.map((i) => i.coverage)).toEqual([null, null]);
});

test("a snapshot freezes the model's classes, and keeps them when a release has the model declare more", async () => {
  const version = await traditionalVersion("class-snapshot-detector", "v1");
  const { dataset } = await reviewedDataset(
    "class-snapshot-dataset",
    ["class-first", "class-second"],
    version,
  );
  const db = await database();
  const model = await requireModel(version.modelId, db);

  const before = await createDatasetSnapshot(dataset.id, new Date(), db);
  expect(before.classes).toEqual(model.classes);

  const grown = [...model.classes, "mouldy"];
  await db
    .update(models)
    .set({ classes: grown })
    .where(eq(models.id, model.id));
  expect(await readDatasetSnapshot(before.id, db)).toEqual(before);
  const after = await createDatasetSnapshot(dataset.id, new Date(), db);
  expect(after.id).not.toBe(before.id);
  expect(after.classes).toEqual(grown);
  expect(after.images).toEqual(before.images);
});
