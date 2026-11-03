import { expect, test } from "bun:test";

import { instancesFromDetection } from "../../domain/annotation/detection";
import { YOLO26N_WHOLE_RECIPE } from "../../domain/training/recipes";
import { readAnnotation, storeAnnotation } from "../annotations/documents";
import { observeTextsIntoDataset } from "../testing/datasets";
import { imageDigest, resultFor } from "../testing/images";
import { seedDetectionResult } from "../testing/inference";
import {
  recordTestHeartbeat,
  testHeartbeat,
  ULTRALYTICS_RUNTIME,
} from "../testing/workers";
import {
  claimTrainingRun,
  createTrainingRun,
  failTrainingRun,
} from "../training/runs";
import { datasetDetail } from "./dataset-detail";
import { modelDetail } from "./model-detail";

/** This test's clock; workers heartbeating at wall-clock time are offline here. */
const HEARTBEAT_AT = new Date(Date.now() + 24 * 60 * 60 * 1000);
const OVERVIEW_AT = new Date(HEARTBEAT_AT.getTime() + 10_000);

test("the overview derives review progress and training readiness", async () => {
  const at = OVERVIEW_AT;
  const { version, dataset } = await observeTextsIntoDataset("overview", [
    "ov-a",
    "ov-b",
    "ov-c",
  ]);
  const worker = await recordTestHeartbeat(
    testHeartbeat("overview-worker"),
    HEARTBEAT_AT,
  );
  for (const name of ["ov-a", "ov-b"]) {
    const digest = await imageDigest(name);
    const result = await resultFor(version, name);
    await seedDetectionResult(
      { versionId: version.id, digest },
      result,
      worker,
    );
    await storeAnnotation(
      { digest, modelId: version.modelId },
      instancesFromDetection(result),
      null,
    );
  }

  let overview = await datasetDetail(dataset.id, at);
  if (!overview) throw new Error("missing overview");
  expect(overview.model.id).toBe(version.modelId);
  expect(overview.defaultTrainingPresetId).toBe("yolo26n-whole-v1");
  expect(overview.trainingPresets.map((preset) => preset.id)).toEqual([
    "yolo26n-whole-v1",
    "yolo26s-whole-2048-v1",
  ]);
  expect(overview.reviewedCount).toBe(2);
  expect(overview.images.map((image) => image.detectionCount)).toEqual([
    0,
    0,
    null,
  ]);
  expect(overview.training).toMatchObject({
    active: null,
    reviewedSinceLastRun: 2,
    workerMemoryBytes: null,
  });

  const run = await createTrainingRun(dataset.id, YOLO26N_WHOLE_RECIPE);
  overview = await datasetDetail(dataset.id, at);
  expect(overview?.training.active?.id).toBe(run.id);
  expect(overview?.training.reviewedSinceLastRun).toBe(0);
  const owner = await recordTestHeartbeat(
    {
      ...testHeartbeat("overview-trainer"),
      runtimes: [ULTRALYTICS_RUNTIME],
      memoryBytes: 24 * 1024 ** 3,
    },
    HEARTBEAT_AT,
  );
  expect((await claimTrainingRun(owner))?.id).toBe(run.id);
  await failTrainingRun(run.id, { ...owner, attempt: 1 }, "stopped");
  overview = await datasetDetail(dataset.id, at);
  expect(overview?.training.active).toBeNull();
  expect(overview?.training.workerMemoryBytes).toBe(24 * 1024 ** 3);

  const a = { digest: await imageDigest("ov-a"), modelId: version.modelId };
  const annotation = await readAnnotation(a);
  if (!annotation) throw new Error("missing annotation");
  await storeAnnotation(a, annotation.instances, annotation.instances);
  expect(
    (await datasetDetail(dataset.id, at))?.training.reviewedSinceLastRun,
  ).toBe(0);
  await storeAnnotation(
    a,
    [
      {
        id: "added",
        class: "ungerminated",
        bbox: { x: 0, y: 0, width: 1, height: 1 },
      },
    ],
    annotation.instances,
  );
  expect(
    (await datasetDetail(dataset.id, at))?.training.reviewedSinceLastRun,
  ).toBe(1);

  expect(
    (await datasetDetail(dataset.id, at))?.runs.map(({ run }) => run.id),
  ).toEqual([run.id]);

  const model = await modelDetail(version.modelId);
  expect(model?.versions.map((item) => item.version.id)).toContain(version.id);
  expect(model?.datasets.map((item) => item.dataset.name)).toContain(
    "overview",
  );
  expect(
    model?.runs.find((summary) => summary.run.id === run.id)?.dataset,
  ).toEqual({ id: dataset.id, name: "overview" });
});

test("the overview is absent for unknown datasets and models", async () => {
  expect(await datasetDetail(crypto.randomUUID())).toBeNull();
  expect(await modelDetail("nowhere")).toBeNull();
});
