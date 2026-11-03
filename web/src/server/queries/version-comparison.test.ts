import { expect, test } from "bun:test";

import { setCurrentVersion } from "../models/public";
import {
  countedResult,
  registerTrainedVersion,
  snapshotImages,
  TEST_RUNTIME,
  traditionalVersion,
  ULTRALYTICS_RUNTIME,
} from "../testing/fixtures";
import { seedDetectionResult } from "../testing/inference";
import { modelDetail } from "./model-detail";
import { versionComparison } from "./version-comparison";

test("a candidate is scored against the reviewers' counts on the held-out images both versions have read", async () => {
  const baseline = await traditionalVersion("compare-detector", "compare-v1");
  const candidate = await registerTrainedVersion(
    "compare-detector",
    "compare-v2",
  );
  const [exactForCandidate, exactForCurrent, unreadByCurrent, trained] =
    await snapshotImages(candidate, [
      {
        content: "compare-a",
        split: "val",
        reviewed: { ungerminated: 5, germinated: 3 },
      },
      { content: "compare-b", split: "val", reviewed: { ungerminated: 2 } },
      { content: "compare-c", split: "val", reviewed: { ungerminated: 1 } },
      { content: "compare-d", split: "train", reviewed: { ungerminated: 4 } },
    ]);
  const read = async (
    version: typeof baseline,
    content: string,
    digest: string,
    counted: Record<string, number>,
  ) => {
    const runtime =
      version.artifact.kind === "ultralytics"
        ? ULTRALYTICS_RUNTIME
        : TEST_RUNTIME;
    await seedDetectionResult(
      { versionId: version.id, digest },
      await countedResult(version, content, counted, runtime),
      { runtimes: [runtime] },
    );
  };
  await read(candidate, "compare-a", exactForCandidate!, {
    ungerminated: 5,
    germinated: 3,
  });
  await read(candidate, "compare-b", exactForCurrent!, { ungerminated: 3 });
  await read(candidate, "compare-c", unreadByCurrent!, { ungerminated: 1 });
  await read(baseline, "compare-a", exactForCandidate!, { ungerminated: 8 });
  await read(baseline, "compare-b", exactForCurrent!, { ungerminated: 2 });

  const comparison = await versionComparison(candidate.modelId, candidate.id);
  expect(comparison).toMatchObject({
    currentVersionId: baseline.id,
    heldOut: 3,
    candidate: { read: 3, failed: 0 },
    current: { read: 2, failed: 0 },
    scored: 2,
    accuracy: {
      candidate: { meanError: { ungerminated: 0.5, germinated: 0 } },
      current: { meanError: { ungerminated: 1.5, germinated: 1.5 } },
    },
  });
  expect(comparison!.images.map((image) => image.digest)).not.toContain(
    trained,
  );
  expect(
    comparison!.images.find((image) => image.digest === unreadByCurrent)
      ?.current,
  ).toBeNull();

  const versions = (await modelDetail(candidate.modelId))!.versions;
  expect(
    versions.map(({ version, training, current, comparison }) => ({
      id: version.id,
      training,
      current,
      scored: comparison?.scored ?? null,
    })),
  ).toEqual([
    {
      id: candidate.id,
      training: {
        runId: "compare-detector.compare-v2.run",
        datasetId: expect.any(String),
        images: 4,
      },
      current: false,
      scored: 2,
    },
    { id: baseline.id, training: null, current: true, scored: null },
  ]);

  await setCurrentVersion({ model: candidate.modelId, version: candidate.id });
  expect(await versionComparison(candidate.modelId, candidate.id)).toBeNull();
});
