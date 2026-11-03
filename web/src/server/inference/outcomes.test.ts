import { describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";

import { instancesFromDetection } from "../../domain/annotation/detection";
import {
  DetectionConflictError,
  DetectionOutcomeInvalidError,
  ProducerMismatchError,
} from "../../domain/inference/errors";
import type { Worker } from "../../domain/workers/schema";
import { storeAnnotation } from "../annotations/documents";
import { addExperimentObservationImagesToNewDataset } from "../datasets/datasets";
import { listImageRecords } from "../datasets/records";
import { retryObservationImageAnalysis } from "../experiments/observation-images";
import { database } from "../infra/db/client";
import { inferenceOutcomes, inferenceTasks } from "../infra/db/schema";
import { observeTextsIntoDataset } from "../testing/datasets";
import {
  listObservationImageRefs,
  observeImages,
} from "../testing/experiments";
import { resultFor } from "../testing/images";
import {
  seedDetectionResult,
  seedInferenceTaskFailure,
} from "../testing/inference";
import { traditionalVersion } from "../testing/models";
import { testHeartbeat } from "../testing/workers";

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

const outcomeVersion = (slug: string, createdAt?: string) =>
  traditionalVersion("outcome-detector", slug, createdAt);

async function isReviewed(ref: { dataset: string; digest: string }) {
  const record = await readImageRecord(ref);
  if (!record) throw new Error(`missing image ${ref.digest}`);
  return record.annotation !== null;
}

describe("detections", () => {
  async function pendingFor(versionId: string, digests: string[]) {
    const db = await database();
    const rows = await db
      .select({ digest: inferenceTasks.imageId })
      .from(inferenceTasks)
      .where(
        and(
          eq(inferenceTasks.modelVersionId, versionId),
          inArray(inferenceTasks.imageId, digests),
          inArray(inferenceTasks.status, ["succeeded", "failed"]),
        ),
      );
    const recorded = new Set(rows.map((row) => row.digest));
    return digests.filter((digest) => !recorded.has(digest));
  }

  test("an experiment needs detections from the version that reads for it", async () => {
    const next = await outcomeVersion("pending-v2");
    const { experiment, version, digests } = await observeImages(
      "pending",
      ["pend-a", "pend-b"],
      next,
    );
    const [a, b] = digests as [string, string];
    const targetA = { versionId: version.id, digest: a };
    const targetB = { versionId: version.id, digest: b };
    expect(await pendingFor(version.id, [a, b])).toEqual(
      expect.arrayContaining([a, b]),
    );

    await seedDetectionResult(
      targetA,
      await resultFor(version, "pend-a"),
      worker,
    );
    await seedInferenceTaskFailure(targetB, "boom");
    expect(await pendingFor(version.id, [a, b])).toEqual([]);
    const cells = await listObservationImageRefs(experiment.id);
    await retryObservationImageAnalysis(cells.get("pend-b")!);
    expect(await pendingFor(version.id, [a, b])).toEqual([b]);
  });

  test("a detection is immutable and identical writes are idempotent", async () => {
    const { version, digests } = await observeImages("once", ["once"]);
    const digest = digests[0]!;
    const target = { versionId: version.id, digest };
    const result = await resultFor(version, "once");
    expect(await seedDetectionResult(target, result, worker)).toEqual(result);
    expect(await seedDetectionResult(target, result, worker)).toEqual(result);
    await expect(
      seedDetectionResult(
        target,
        { ...result, quality: { status: "review_required", warnings: [] } },
        worker,
      ),
    ).rejects.toBeInstanceOf(DetectionConflictError);
    expect(await storedDetection(target)).toEqual(result);
  });

  test("an outcome must describe its image and its producer", async () => {
    const { version, digests } = await observeImages("mismatch", ["mismatch"]);
    const digest = digests[0]!;
    const target = { versionId: version.id, digest };
    await expect(
      seedDetectionResult(
        target,
        await resultFor(version, "elsewhere"),
        worker,
      ),
    ).rejects.toThrow(/describes/);

    const result = await resultFor(version, "mismatch");
    await expect(
      seedDetectionResult(
        target,
        {
          ...result,
          instances: [
            {
              id: "unknown",
              class: "debris",
              bbox: { x: 1, y: 1, width: 5, height: 5 },
              score: 0.9,
            },
          ],
        },
        worker,
      ),
    ).rejects.toBeInstanceOf(DetectionOutcomeInvalidError);
    await expect(
      seedDetectionResult(
        target,
        {
          ...result,
          image: { digest, width: 1, height: 1 },
          instances: [],
        },
        worker,
      ),
    ).rejects.toThrow(/1x1/);
    await expect(
      seedDetectionResult(
        {
          ...target,
          versionId: (await outcomeVersion("mismatch-v2")).id,
        },
        result,
        worker,
      ),
    ).rejects.toBeInstanceOf(ProducerMismatchError);
    await expect(
      seedDetectionResult(
        target,
        {
          ...result,
          producer: { ...result.producer, artifactDigest: "d".repeat(64) },
        },
        worker,
      ),
    ).rejects.toBeInstanceOf(ProducerMismatchError);
    await expect(
      seedDetectionResult(target, result, {
        runtimes: [{ adapter: "ultralytics", fingerprint: "c".repeat(64) }],
      }),
    ).rejects.toBeInstanceOf(ProducerMismatchError);
    const wrongRuntime = {
      adapter: "ultralytics" as const,
      fingerprint: "c".repeat(64),
    };
    await expect(
      seedDetectionResult(
        target,
        { ...result, producer: { ...result.producer, runtime: wrongRuntime } },
        { runtimes: [wrongRuntime] },
      ),
    ).rejects.toBeInstanceOf(ProducerMismatchError);
    expect(await storedDetection(target)).toBeNull();
  });

  test("a dataset shows the newest detection whether or not a review exists", async () => {
    const baseline = await outcomeVersion(
      "shown-v1",
      "2026-08-26T01:00:00.000Z",
    );
    const {
      version: next,
      digests,
      dataset,
    } = await observeTextsIntoDataset(
      "shown",
      ["shown"],
      await outcomeVersion("shown-v2", "2026-08-27T02:00:00.000Z"),
    );
    const digest = digests[0]!;
    const ref = { dataset: dataset.id, digest };
    expect(await isReviewed(ref)).toBe(false);
    expect((await readImageRecord(ref))?.detection).toBeNull();

    const original = await resultFor(baseline, "shown");
    await seedDetectionResult(
      { versionId: baseline.id, digest },
      original,
      worker,
    );
    expect((await readImageRecord(ref))?.detection).toEqual(original);

    const newer = await resultFor(next, "shown");
    await seedDetectionResult({ versionId: next.id, digest }, newer, worker);
    expect((await readImageRecord(ref))?.detection).toEqual(newer);

    const failedVersion = await outcomeVersion(
      "shown-v3",
      "2026-08-27T03:00:00.000Z",
    );
    await seedInferenceTaskFailure(
      { versionId: failedVersion.id, digest },
      "runtime failed",
    );
    expect((await readImageRecord(ref))?.detection).toEqual(newer);

    await storeAnnotation(
      { digest, modelId: baseline.modelId },
      instancesFromDetection(original),
      null,
    );
    expect((await readImageRecord(ref))?.detection).toEqual(newer);
    expect(await isReviewed(ref)).toBe(true);
  });

  test("a review is one document per image and model, wherever it is opened", async () => {
    const {
      version,
      digests,
      images,
      dataset: one,
    } = await observeTextsIntoDataset("ctx-one", ["ctx"]);
    const { dataset: two } = await addExperimentObservationImagesToNewDataset({
      name: "ctx-two",
      images,
    });
    const digest = digests[0]!;
    const result = await resultFor(version, "ctx");
    await seedDetectionResult(
      { versionId: version.id, digest },
      result,
      worker,
    );
    const labelRef = { digest, modelId: version.modelId };
    await storeAnnotation(labelRef, instancesFromDetection(result), null);
    expect(await isReviewed({ dataset: one.id, digest })).toBe(true);
    expect(await isReviewed({ dataset: two.id, digest })).toBe(true);
  });
});
