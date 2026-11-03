import { expect, test } from "bun:test";

import { observeTextsIntoDataset } from "../testing/datasets";
import { imageDigest, resultFor } from "../testing/images";
import { seedDetectionResult } from "../testing/inference";
import { testHeartbeat } from "../testing/workers";
import { datasetImageDetail } from "./dataset-image-detail";

test("a dataset image page steps through the dataset in its order", async () => {
  const { version, dataset } = await observeTextsIntoDataset("di", [
    "di-a",
    "di-b",
    "di-c",
  ]);
  const [a, b, c] = await Promise.all(
    ["di-a", "di-b", "di-c"].map((name) => imageDigest(name)),
  );
  const result = await resultFor(version, "di-b");
  await seedDetectionResult({ versionId: version.id, digest: b! }, result, {
    runtimes: testHeartbeat("di-worker").runtimes,
  });

  const middle = await datasetImageDetail({ dataset: dataset.id, digest: b! });
  expect(middle?.model.id).toBe(version.modelId);
  expect(middle?.review).toEqual({
    ref: { digest: b!, modelId: version.modelId },
    filename: "di-b.jpg",
    width: middle!.review.width,
    height: middle!.review.height,
    detection: result,
    proposal: null,
    annotation: null,
    progress: null,
  });
  expect(middle?.previous).toEqual({ digest: a!, filename: "di-a.jpg" });
  expect(middle?.next).toEqual({ digest: c!, filename: "di-c.jpg" });

  const first = await datasetImageDetail({ dataset: dataset.id, digest: a! });
  expect(first?.previous).toBeNull();
  expect(first?.review.detection).toBeNull();

  expect(
    await datasetImageDetail({ dataset: dataset.id, digest: "0".repeat(64) }),
  ).toBeNull();
  expect(
    await datasetImageDetail({ dataset: crypto.randomUUID(), digest: a! }),
  ).toBeNull();
});
