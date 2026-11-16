import { randomUUID } from "node:crypto";

import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { ImageNotFoundError } from "../../domain/images/errors";
import { PhotoBatchNotFoundError } from "../../domain/photos/errors";
import { createObservation } from "../experiments/observations";
import { collectImages } from "../images/collection";
import { connect } from "../infra/db/connection";
import { photoBatches, photoBatchPhotos } from "../infra/db/schema";
import { signInAs } from "../testing/auth";
import {
  contendedTest,
  testDatabaseUrl,
  waitForLockContention,
} from "../testing/contention";
import {
  assignImages,
  createExperiment,
  INOCULATED,
  reading,
  unitsOf,
} from "../testing/experiments";
import { imageDigest, storeTexts } from "../testing/images";
import { trainedVersion } from "../testing/models";
import {
  addBatchPhoto,
  createPhotoBatch,
  deletePhotoBatch,
  listPhotoBatchOverviews,
  photoBatchDetail,
  removeBatchPhoto,
} from "./batches";

async function account(): Promise<string> {
  return (await signInAs("member")).user.id;
}

/** A batch of `owner`'s holding one photograph per content, named `<content>.jpg`. */
async function batchOf(owner: string, name: string, contents: string[]) {
  const batch = await createPhotoBatch(owner, { name });
  const digests = await storeTexts(contents);
  for (const [index, digest] of digests.entries()) {
    await addBatchPhoto(owner, {
      batch: batch.id,
      digest,
      filename: `${contents[index]}.jpg`,
    });
  }
  return { batch, digests };
}

describe("photo batches", () => {
  test("a batch lists its photographs in the order of their file names", async () => {
    const owner = await account();
    const { batch } = await batchOf(owner, "Day 7", [
      "batch-order-10",
      "batch-order-9",
      "batch-order-2",
    ]);

    const detail = await photoBatchDetail(owner, { batch: batch.id });
    expect(detail?.batch).toEqual(batch);
    expect(detail?.photos.map((photo) => photo.filename)).toEqual([
      "batch-order-2.jpg",
      "batch-order-9.jpg",
      "batch-order-10.jpg",
    ]);
    expect(await listPhotoBatchOverviews(owner)).toEqual([
      { ...batch, photoCount: 3 },
    ]);
  });

  test("a photograph already in the batch keeps its name", async () => {
    const owner = await account();
    const { batch, digests } = await batchOf(owner, "Again", ["batch-again"]);

    await addBatchPhoto(owner, {
      batch: batch.id,
      digest: digests[0]!,
      filename: "renamed.jpg",
    });
    const detail = await photoBatchDetail(owner, { batch: batch.id });
    expect(detail?.photos.map((photo) => photo.filename)).toEqual([
      "batch-again.jpg",
    ]);
  });

  test("a batch is its owner's alone", async () => {
    const owner = await account();
    const other = await account();
    const { batch, digests } = await batchOf(owner, "Mine", ["batch-mine"]);

    expect(await listPhotoBatchOverviews(other)).toEqual([]);
    expect(await photoBatchDetail(other, { batch: batch.id })).toBeNull();
    await expect(
      addBatchPhoto(other, {
        batch: batch.id,
        digest: digests[0]!,
        filename: "theirs.jpg",
      }),
    ).rejects.toThrow(PhotoBatchNotFoundError);
    await expect(
      removeBatchPhoto(other, { batch: batch.id, digest: digests[0]! }),
    ).rejects.toThrow(PhotoBatchNotFoundError);
    await expect(deletePhotoBatch(other, { batch: batch.id })).rejects.toThrow(
      PhotoBatchNotFoundError,
    );
    expect(
      (await photoBatchDetail(owner, { batch: batch.id }))?.photos,
    ).toHaveLength(1);
  });

  test("a batch takes only stored photographs", async () => {
    const owner = await account();
    const batch = await createPhotoBatch(owner, { name: "Unstored" });
    await expect(
      addBatchPhoto(owner, {
        batch: batch.id,
        digest: await imageDigest(`never-stored-${randomUUID()}`),
        filename: "absent.jpg",
      }),
    ).rejects.toThrow(ImageNotFoundError);
  });

  test("a waiting photograph outlives the period an unclaimed image is kept for", async () => {
    const owner = await account();
    const { batch, digests } = await batchOf(owner, "Kept", ["batch-kept"]);
    const later = () => new Date(Date.now() + 25 * 60 * 60 * 1000);

    expect(await collectImages(later())).not.toContain(digests[0]);

    await removeBatchPhoto(owner, { batch: batch.id, digest: digests[0]! });
    expect(await collectImages(later())).toContain(digests[0]);
  });

  test("deleting a batch lets go of its photographs", async () => {
    const owner = await account();
    const { batch, digests } = await batchOf(owner, "Dropped", [
      "batch-dropped",
    ]);

    await deletePhotoBatch(owner, { batch: batch.id });

    expect(await listPhotoBatchOverviews(owner)).toEqual([]);
    expect(
      await collectImages(new Date(Date.now() + 25 * 60 * 60 * 1000)),
    ).toContain(digests[0]);
  });

  test("a photograph leaves its batches once an experiment holds it", async () => {
    const owner = await account();
    const other = await account();
    const version = await trainedVersion("photo-batch-placing");
    const experiment = await createExperiment({
      name: "Photo batch placing",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    const day = await createObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    const partly = await batchOf(owner, "Partly placed", [
      "batch-placed-1",
      "batch-waiting",
    ]);
    const wholly = await batchOf(other, "Wholly placed", ["batch-placed-1"]);

    await assignImages(experiment.id, day.id, units, {
      "A-1": "batch-placed-1",
    });

    const left = await photoBatchDetail(owner, { batch: partly.batch.id });
    expect(left?.photos.map((photo) => photo.filename)).toEqual([
      "batch-waiting.jpg",
    ]);
    expect(
      await photoBatchDetail(other, { batch: wholly.batch.id }),
    ).toBeNull();
  });

  test("a batch its owner empties stays", async () => {
    const owner = await account();
    const { batch, digests } = await batchOf(owner, "Emptied by hand", [
      "batch-emptied",
    ]);

    await removeBatchPhoto(owner, { batch: batch.id, digest: digests[0]! });
    await removeBatchPhoto(owner, { batch: batch.id, digest: digests[0]! });

    expect(await listPhotoBatchOverviews(owner)).toEqual([
      { ...batch, photoCount: 0 },
    ]);
  });

  test("a photograph an experiment already holds waits until it is placed again", async () => {
    const owner = await account();
    const version = await trainedVersion("photo-batch-held");
    const [first, second] = await Promise.all(
      ["Photo batch held 1", "Photo batch held 2"].map(async (name) => {
        const experiment = await createExperiment({
          name,
          inoculatedOn: INOCULATED,
          treatments: [{ name: "A", replicates: 1 }],
        });
        const day = await createObservation({
          experiment: experiment.id,
          observedOn: "2026-08-08",
          note: "",
          ...reading(version),
        });
        return { experiment, day, units: await unitsOf(experiment.id) };
      }),
    );
    const place = ({ experiment, day, units }: NonNullable<typeof first>) =>
      assignImages(experiment.id, day.id, units, { "A-1": "batch-held" });

    await place(first!);
    const { batch } = await batchOf(owner, "Held", ["batch-held"]);
    expect(
      (await photoBatchDetail(owner, { batch: batch.id }))?.photos,
    ).toHaveLength(1);

    await place(second!);
    expect(await photoBatchDetail(owner, { batch: batch.id })).toBeNull();
  });

  contendedTest(
    "a photograph added while the batch's last one is placed keeps the batch",
    async () => {
      const owner = await account();
      const version = await trainedVersion("photo-batch-contended");
      const experiment = await createExperiment({
        name: "Photo batch contended",
        inoculatedOn: INOCULATED,
        treatments: [{ name: "A", replicates: 1 }],
      });
      const units = await unitsOf(experiment.id);
      const day = await createObservation({
        experiment: experiment.id,
        observedOn: "2026-08-08",
        note: "",
        ...reading(version),
      });
      const { batch } = await batchOf(owner, "Contended", ["batch-last"]);
      const [arriving] = await storeTexts(["batch-arriving"]);

      const other = await connect(testDatabaseUrl!);
      let add = (): void => {};
      let commit = (): void => {};
      const added = new Promise<void>((resolve) => {
        add = resolve;
      });
      const committed = new Promise<void>((resolve) => {
        commit = resolve;
      });
      const adding = other.db.transaction(async (db) => {
        await db
          .select({ id: photoBatches.id })
          .from(photoBatches)
          .where(eq(photoBatches.id, batch.id))
          .for("share");
        await db.insert(photoBatchPhotos).values({
          batchId: batch.id,
          imageId: arriving!,
          filename: "batch-arriving.jpg",
        });
        add();
        await committed;
      });

      try {
        await added;
        const placing = assignImages(experiment.id, day.id, units, {
          "A-1": "batch-last",
        });
        await waitForLockContention(testDatabaseUrl!);
        commit();
        await adding;
        await placing;
        const detail = await photoBatchDetail(owner, { batch: batch.id });
        expect(detail?.photos.map((photo) => photo.filename)).toEqual([
          "batch-arriving.jpg",
        ]);
      } finally {
        commit();
        await adding.catch(() => {});
        await other.close();
      }
    },
  );
});
