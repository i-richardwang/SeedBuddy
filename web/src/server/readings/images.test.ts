import { expect, test } from "bun:test";

import { instancesFromDetection } from "../../domain/annotation/detection";
import { storeAnnotation } from "../annotations/documents";
import { database } from "../infra/db/client";
import { setCurrentVersion } from "../models/public";
import {
  observeImages,
  recordTestHeartbeat,
  registerTrainedVersion,
  resultFor,
  TEST_RUNTIME,
  testHeartbeat,
  traditionalVersion,
  ULTRALYTICS_RUNTIME,
} from "../testing/fixtures";
import { seedDetectionResult } from "../testing/inference";
import { readReview } from "./images";

test("a review shows the current version's detection and the stored annotation", async () => {
  const worker = await recordTestHeartbeat({
    ...testHeartbeat("review-worker"),
    runtimes: [TEST_RUNTIME, ULTRALYTICS_RUNTIME],
  });
  const baseline = await traditionalVersion("review-detector", "review-v1");
  const first = await observeImages("review v1", ["rv"], baseline);
  const next = await registerTrainedVersion(first.version.modelId, "review-v2");
  await observeImages("review v2", ["rv"], next);
  const digest = first.digests[0]!;
  const ref = { digest, modelId: first.version.modelId };
  const older = await resultFor(first.version, "rv");
  const newer = await resultFor(next, "rv", ULTRALYTICS_RUNTIME);
  await seedDetectionResult(
    { versionId: first.version.id, digest },
    older,
    worker,
  );
  await seedDetectionResult({ versionId: next.id, digest }, newer, worker);
  const db = await database();

  expect((await readReview(ref, "rv.jpg", db))?.detection).toEqual(older);
  await setCurrentVersion({ model: next.modelId, version: next.id });
  expect((await readReview(ref, "rv.jpg", db))?.detection).toEqual(newer);
  expect((await readReview(ref, "rv.jpg", db))?.filename).toBe("rv.jpg");

  expect((await readReview(ref, "rv.jpg", db))?.annotation).toBeNull();
  const saved = await storeAnnotation(ref, instancesFromDetection(older), null);
  const reviewed = await readReview(ref, "rv.jpg", db);
  expect(reviewed?.annotation).toEqual(saved);
  expect(reviewed?.detection).toEqual(newer);
});
