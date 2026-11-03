import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { instancesFromDetection } from "../../domain/annotation/detection";
import { DEFAULT_MODEL_ANNOTATION } from "../../domain/models/schema";
import type { Worker } from "../../domain/workers/schema";
import { readAnnotation, storeAnnotation } from "../annotations/documents";
import { collectImages } from "../images/collection";
import { imageBlobKey } from "../images/keys";
import { storeImage } from "../images/store";
import { markImageUnclear } from "../images/unclear";
import { blobExists, requireBlob } from "../infra/blobs/store";
import { database } from "../infra/db/client";
import { inferenceOutcomes } from "../infra/db/schema";
import { contentDigest } from "../infra/digest";
import { createModel, registerModel } from "../models/registry";
import { observeTextsIntoDataset } from "../testing/datasets";
import { observeImages, observeImagesForModel } from "../testing/experiments";
import {
  FIXTURE_EDGE,
  imageBytes,
  imageDigest,
  resultFor,
} from "../testing/images";
import { seedDetectionResult } from "../testing/inference";
import { registerTrainedVersion } from "../testing/models";
import { testHeartbeat } from "../testing/workers";
import {
  addExperimentObservationImages,
  addExperimentObservationImagesToNewDataset,
  createDataset,
  listDatasets,
  listDatasetsForModel,
  readDataset,
  readDatasetByName,
  removeDatasetImages,
} from "./memberships";
import { listImageRecords, readDatasetContents } from "./records";

const worker: Worker = {
  ...testHeartbeat("worker"),
  lastSeenAt: "2026-08-27T00:00:00.000Z",
};

async function readImageRecord(ref: { dataset: string; digest: string }) {
  return (
    (await listImageRecords(ref.dataset)).find(
      (record) => record.image.digest === ref.digest,
    ) ?? null
  );
}

/** The succeeded outcome stored for one image-version pair, if any. */
async function storedDetection(target: { versionId: string; digest: string }) {
  const db = await database();
  const [row] = await db
    .select({ document: inferenceOutcomes.document })
    .from(inferenceOutcomes)
    .where(
      and(
        eq(inferenceOutcomes.imageId, target.digest),
        eq(inferenceOutcomes.modelVersionId, target.versionId),
      ),
    );
  return row?.document ?? null;
}

describe("datasets", () => {
  test("a stored image belongs to nothing until an observation is submitted", async () => {
    const stored = await storeImage(await imageBytes("loose"));
    expect(stored).toEqual({
      digest: await imageDigest("loose"),
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
      bytes: stored.bytes,
    });
    expect(await blobExists(imageBlobKey(stored.digest))).toBe(true);
    const { experiment } = await observeImages("loose images", ["loose-other"]);
    const missing = "11111111-1111-4111-8111-111111111111";
    await expect(
      addExperimentObservationImagesToNewDataset({
        name: "loose",
        images: [{ experiment: experiment.id, observationImage: missing }],
      }),
    ).rejects.toThrow(
      `Not experiment observation images: ${experiment.id}/${missing}`,
    );
    expect(await readDatasetByName("loose")).toBeNull();
    const unknown = crypto.randomUUID();
    await expect(
      addExperimentObservationImages({
        dataset: unknown,
        images: [{ experiment: experiment.id, observationImage: missing }],
      }),
    ).rejects.toThrow(`Unknown dataset: ${unknown}`);
  });

  test("adds experiment images under their source filenames", async () => {
    const { digests, images } = await observeImages("crop images", [
      "one",
      "two",
    ]);
    const { dataset, ...counts } =
      await addExperimentObservationImagesToNewDataset({
        name: "crop",
        images,
      });
    expect(counts).toEqual({ added: 2, existing: 0 });
    const listed = await listImageRecords(dataset.id);
    expect(listed.map(({ image }) => image.digest).sort()).toEqual(
      [...digests].sort(),
    );
    expect(
      listed.find(({ image }) => image.filename === "two.jpg")?.image,
    ).toMatchObject({
      dataset: dataset.id,
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
      split: null,
    });
    expect((await listDatasets()).map(({ name }) => name)).toContain("crop");
    expect(await readDataset(dataset.id)).toEqual({
      id: expect.any(String),
      name: "crop",
      modelId: "seed-detector",
    });
    expect(
      await addExperimentObservationImages({
        dataset: dataset.id,
        images: [images[0]!],
      }),
    ).toMatchObject({ added: 0, existing: 1 });
  });

  test("an unclear photograph joins like any other and shows its mark", async () => {
    const { images, digests } = await observeImages("Unclear joining", [
      "uj-fogged",
      "uj-clear",
    ]);
    const [fogged, clear] = digests;
    await markImageUnclear({ digest: fogged! });
    const { dataset, ...counts } =
      await addExperimentObservationImagesToNewDataset({
        name: "unclear-joining",
        images,
      });
    expect(counts).toEqual({ added: 2, existing: 0 });
    const contents = await readDatasetContents(dataset.id);
    const marks = new Map(
      contents!.images.map((image) => [image.digest, image.unclear]),
    );
    expect(marks.get(fogged!)).toBe(true);
    expect(marks.get(clear!)).toBe(false);
  });

  test("an untrained model's reviewed images become the set it trains on", async () => {
    const model = await createModel({
      id: "bootstrap-task",
      name: "Bootstrap task",
      classes: ["germinated"],
    });
    const observed = await observeImagesForModel(
      "bootstrap images",
      ["bootstrapped"],
      model.id,
    );
    const { dataset } = await addExperimentObservationImagesToNewDataset({
      name: "bootstrap",
      images: observed.images,
    });
    expect(dataset).toEqual({
      id: expect.any(String),
      name: "bootstrap",
      modelId: model.id,
    });
    expect(
      (await listDatasetsForModel(model.id)).map(({ name }) => name),
    ).toEqual(["bootstrap"]);
  });

  test("a dataset trains the model its experiment images were observed for", async () => {
    const seed = await observeImages("model images", ["modelled"]);
    const { dataset: oneModel } =
      await addExperimentObservationImagesToNewDataset({
        name: "one-model",
        images: seed.images,
      });
    await registerModel({
      schemaVersion: 1,
      id: "other-task",
      name: "Other task",
      task: "object_detection",
      classes: ["seed"],
      annotation: DEFAULT_MODEL_ANNOTATION,
    });
    const otherVersion = await registerTrainedVersion("other-task");
    const other = await observeImages(
      "other images",
      ["modelled-elsewhere"],
      otherVersion,
    );
    await expect(
      addExperimentObservationImages({
        dataset: oneModel.id,
        images: other.images,
      }),
    ).rejects.toThrow(/trains seed-detector, not other-task/);
    await addExperimentObservationImagesToNewDataset({
      name: "other-model",
      images: other.images,
    });
    const seedDatasets = (await listDatasetsForModel("seed-detector")).map(
      ({ name }) => name,
    );
    expect(seedDatasets).toContain("one-model");
    expect(seedDatasets).not.toContain("other-model");
    expect(
      (await listDatasetsForModel("other-task")).map(({ name }) => name),
    ).toContain("other-model");
    await expect(
      addExperimentObservationImagesToNewDataset({
        name: "mixed",
        images: [...seed.images, ...other.images],
      }),
    ).rejects.toThrow(/different models/);
    expect(await readDatasetByName("mixed")).toBeNull();

    const sameSeed = await observeImages(
      "same seed content",
      ["same-content"],
      seed.version,
    );
    const sameOther = await observeImages(
      "same other content",
      ["same-content"],
      otherVersion,
    );
    expect(sameSeed.digests).toEqual(sameOther.digests);
    await expect(
      addExperimentObservationImagesToNewDataset({
        name: "mixed-same-content",
        images: [...sameSeed.images, ...sameOther.images],
      }),
    ).rejects.toThrow(/different models/);
    expect(await readDatasetByName("mixed-same-content")).toBeNull();

    await expect(
      addExperimentObservationImagesToNewDataset({
        name: "not a name",
        images: seed.images,
      }),
    ).rejects.toThrow();
    expect(await readDatasetByName("not a name")).toBeNull();
  });

  test("one image can belong to several datasets", async () => {
    const { digests, images } = await observeImages("shared images", [
      "shared",
    ]);
    const digest = digests[0]!;
    for (const name of ["left", "right"]) {
      const { dataset } = await addExperimentObservationImagesToNewDataset({
        name,
        images,
      });
      expect(
        (await readImageRecord({ dataset: dataset.id, digest }))?.image
          .filename,
      ).toBe("shared.jpg");
    }
    expect(contentDigest(await requireBlob(imageBlobKey(digest)))).toBe(digest);
  });

  test("a source that is not an image is not stored", async () => {
    await expect(storeImage(new TextEncoder().encode("notes"))).rejects.toThrow(
      /JPEG, PNG, or TIFF/,
    );
    await expect(storeImage(new Uint8Array())).rejects.toThrow(/empty/);
  });

  test("serializes concurrent additions to a new dataset", async () => {
    const a = await observeImages("concurrent a", ["concurrent-a"]);
    const b = await observeImages("concurrent b", ["concurrent-b"]);
    const dataset = await createDataset({
      name: "concurrent",
      modelId: "seed-detector",
    });
    const [first, second] = await Promise.all([
      addExperimentObservationImages({
        dataset: dataset.id,
        images: a.images,
      }),
      addExperimentObservationImages({
        dataset: dataset.id,
        images: b.images,
      }),
    ]);
    expect(first.added).toBe(1);
    expect(second.added).toBe(1);
    expect(await listImageRecords(dataset.id)).toHaveLength(2);
  });
});

describe("removal", () => {
  test("removes the membership; the review and the detection stay with the image", async () => {
    const { version, digests, dataset } = await observeTextsIntoDataset("rm", [
      "rm-bytes",
    ]);
    const digest = digests[0]!;
    const ref = { dataset: dataset.id, digest };
    const target = { versionId: version.id, digest };
    const result = await resultFor(version, "rm-bytes");
    await seedDetectionResult(target, result, worker);
    await storeAnnotation(
      { digest, modelId: version.modelId },
      instancesFromDetection(result),
      null,
    );

    expect(
      await removeDatasetImages({ dataset: dataset.id, digests: [digest] }),
    ).toMatchObject({ removed: 1, absent: 0 });
    expect(await readImageRecord(ref)).toBeNull();
    expect(
      await readAnnotation({ digest, modelId: version.modelId }),
    ).not.toBeNull();
    expect(await storedDetection(target)).toEqual(result);
    expect(
      await removeDatasetImages({ dataset: dataset.id, digests: [digest] }),
    ).toMatchObject({ removed: 0, absent: 1 });
  });

  test("a review keeps the image alive after its last membership and observation are gone", async () => {
    const { digests, images, dataset } = await observeTextsIntoDataset(
      "share-a",
      ["shared-bytes"],
    );
    const digest = digests[0]!;
    const { dataset: shareB } =
      await addExperimentObservationImagesToNewDataset({
        name: "share-b",
        images,
      });
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    await removeDatasetImages({ dataset: dataset.id, digests: [digest] });
    expect(await collectImages(later)).not.toContain(digest);
    expect(
      await readImageRecord({ dataset: shareB.id, digest }),
    ).not.toBeNull();
    await removeDatasetImages({ dataset: shareB.id, digests: [digest] });
    expect(await collectImages(later)).not.toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(true);
  });
});

test("missing dataset source images use the experiment-owned refusal", async () => {
  await expect(
    addExperimentObservationImagesToNewDataset({
      name: `Missing source ${crypto.randomUUID()}`,
      images: [
        {
          experiment: crypto.randomUUID(),
          observationImage: crypto.randomUUID(),
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "experiment_observation_image_not_found" });
});
