import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { listBlobs } from "../infra/blobs/store";
import { database } from "../infra/db/client";
import { modelUploads, trainingRuns } from "../infra/db/schema";
import { contentDigest } from "../infra/digest";
import { trainingBundle } from "../testing/model-bundle";
import {
  publication,
  recipe,
  trainer,
  trainingDataset,
} from "../testing/training";
import { saveTrainingArtifactPart } from "./artifacts";
import { controlTrainingRun } from "./control";
import { completeTrainingRun } from "./publication";
import { claimTrainingRun, createTrainingRun } from "./runs";
import { readDatasetSnapshot } from "./snapshots";

async function preparedPublication(name: string) {
  const dataset = await trainingDataset(name);
  const owner = await trainer(`${name}-worker`);
  const run = await createTrainingRun(dataset.id, recipe, owner.workerId);
  expect((await claimTrainingRun(owner))?.id).toBe(run.id);
  const db = await database();
  const snapshot = (await readDatasetSnapshot(run.datasetSnapshotId, db))!;
  const weights = new TextEncoder().encode(name);
  const bundle = trainingBundle(
    weights,
    publication,
    snapshot.classes,
    snapshot.id,
  );
  await saveTrainingArtifactPart(
    run.id,
    {
      upload: bundle.weights,
      part: 0,
      digest: contentDigest(weights),
      bytes: weights,
    },
    owner,
  );
  const storage = async () => ({
    uploads: await db
      .select()
      .from(modelUploads)
      .where(eq(modelUploads.modelId, run.modelId)),
    blobs: (await listBlobs("model-artifacts/")).sort(),
  });
  return { dataset, owner, run, bundle, db, storage };
}

test.each([
  "cancelled",
  "paused",
  "expired",
  "superseded",
  "foreign-worker",
] as const)(
  "%s publication is refused before creating uploads or writing weights",
  async (reason) => {
    const { dataset, owner, run, bundle, db, storage } =
      await preparedPublication(`publication-${reason}`);
    let sender = owner;
    if (
      reason === "cancelled" ||
      reason === "paused" ||
      reason === "superseded"
    ) {
      await controlTrainingRun(dataset.id, run.id, 1, {
        action: reason === "cancelled" ? "cancel" : "pause",
      });
      if (reason === "superseded") {
        await controlTrainingRun(dataset.id, run.id, 1, {
          action: "resume",
          targetWorkerId: owner.workerId,
          restart: true,
        });
        expect((await claimTrainingRun(owner))?.attempt).toBe(2);
      }
    } else if (reason === "expired") {
      await db
        .update(trainingRuns)
        .set({ leaseExpiresAt: new Date(0) })
        .where(eq(trainingRuns.id, run.id));
    } else {
      sender = await trainer("publication-foreign-sender");
    }
    const before = await storage();
    await expect(completeTrainingRun(run.id, bundle, sender)).rejects.toThrow(
      /not owned/,
    );
    expect(await storage()).toEqual(before);
    if (reason !== "cancelled") {
      await controlTrainingRun(
        dataset.id,
        run.id,
        reason === "superseded" ? 2 : 1,
        { action: "cancel" },
      );
    }
  },
);

test("completed publication retries and conflicts leave upload storage unchanged", async () => {
  const { owner, run, bundle, storage } =
    await preparedPublication("publication-retry");
  const completed = await completeTrainingRun(run.id, bundle, owner);
  const before = await storage();
  expect(await completeTrainingRun(run.id, bundle, owner)).toEqual(completed);
  expect(await storage()).toEqual(before);
  await expect(
    completeTrainingRun(
      run.id,
      {
        ...bundle,
        inference: { ...bundle.inference, confidence: 0.7 },
      },
      owner,
    ),
  ).rejects.toThrow(/different contents/);
  await expect(
    completeTrainingRun(run.id, bundle, { ...owner, attempt: 2 }),
  ).rejects.toThrow(/superseded/);
  expect(await storage()).toEqual(before);
});

test("a bundle must find the classes its snapshot froze", async () => {
  const { dataset, owner, run, bundle } = await preparedPublication(
    "publication-classes",
  );
  const fewer = { ...bundle, classes: bundle.classes.slice(0, 1) };
  await expect(completeTrainingRun(run.id, fewer, owner)).rejects.toThrow(
    /classes the snapshot froze/,
  );
  await controlTrainingRun(dataset.id, run.id, 1, { action: "cancel" });
});

test("a bundle must read in the mode its snapshot was framed for", async () => {
  const { dataset, owner, run, bundle } =
    await preparedPublication("publication-mode");
  expect(bundle.inference.mode).toBe("whole_image");
  const framed = {
    ...bundle,
    inference: { ...bundle.inference, mode: "dish" as const },
  };
  await expect(completeTrainingRun(run.id, framed, owner)).rejects.toThrow(
    /dish mode; the snapshot was framed for whole_image/,
  );
  await controlTrainingRun(dataset.id, run.id, 1, { action: "cancel" });
});
