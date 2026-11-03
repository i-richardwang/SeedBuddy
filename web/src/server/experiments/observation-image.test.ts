import { expect, test } from "bun:test";

import { setCurrentVersion } from "../models/registry";
import { imageDigest } from "../testing/images";
import { seedDetectionResult } from "../testing/inference";
import { registerTrainedVersion } from "../testing/models";
import { experimentObservationImageDetail } from "./observation-image";
import { createObservation } from "./observations";
import { experimentGridDetail } from "./queries";
import {
  assignImages,
  countedImageResult,
  createExperiment,
  INOCULATED,
  reading,
  trainedVersion,
  unitsOf,
  worker,
} from "./testing";

test("a trained version reads only once it is made current, and the one left behind returns at once", async () => {
  const first = await trainedVersion("exp-retrained");
  const experiment = await createExperiment({
    name: "Retrained",
    inoculatedOn: INOCULATED,
  });
  const units = await unitsOf(experiment.id);
  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(first),
  });
  await assignImages(experiment.id, day7.id, units, {
    "A-1": "retrained-d7",
  });
  const digest = await imageDigest("retrained-d7");
  const imageOf = async () =>
    (await experimentGridDetail(experiment.id))!.images.find(
      (image) => image.digest === digest,
    )!;
  const ref = {
    experiment: experiment.id,
    observationImage: (await imageOf()).id,
  };
  await seedDetectionResult(
    { versionId: first.id, digest },
    countedImageResult(first, digest, 3),
    worker,
  );
  const read = (await experimentObservationImageDetail(ref))!;
  expect(read.review.detection?.instances).toHaveLength(3);

  const next = await registerTrainedVersion("exp-retrained", "yolo-v2");
  expect((await imageOf()).state).toBe("analyzed");

  await setCurrentVersion({ model: "exp-retrained", version: next.id });
  expect((await imageOf()).state).toBe("pending");
  expect(
    (await experimentObservationImageDetail(ref))!.review.detection?.instances,
  ).toHaveLength(3);

  await setCurrentVersion({ model: "exp-retrained", version: first.id });
  expect((await imageOf()).state).toBe("analyzed");
  expect((await imageOf()).detectionTally).toEqual({ ungerminated: 3 });
});
