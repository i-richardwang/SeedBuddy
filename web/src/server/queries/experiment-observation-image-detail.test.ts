import { expect, test } from "bun:test";

import { storeAnnotation } from "../annotations/documents";
import { createObservation } from "../experiments/observations";
import { createModel, setCurrentVersion } from "../models/registry";
import { experimentObservationImageDetail } from "../queries/experiment-observation-image-detail";
import { experimentRecordsDetail } from "../queries/experiment-records-detail";
import {
  assignImages,
  createExperiment,
  INOCULATED,
  reading,
  unitsOf,
} from "../testing/experiments";
import { countedImageResult, imageDigest } from "../testing/images";
import { seedDetectionResult } from "../testing/inference";
import { registerTrainedVersion, trainedVersion } from "../testing/models";
import { ultralyticsWorker as worker } from "../testing/workers";

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
    (await experimentRecordsDetail(experiment.id))!.images.find(
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

test("an untrained model is observed and read by a reviewer alone", async () => {
  const model = await createModel({
    id: "exp-untrained",
    name: "Rooting",
    classes: ["rooted"],
  });
  const experiment = await createExperiment({
    name: "Untrained",
    inoculatedOn: INOCULATED,
  });
  const units = await unitsOf(experiment.id);
  const observation = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-15",
    note: "",
    modelId: model.id,
  });
  await assignImages(experiment.id, observation.id, units, {
    "A-1": "untrained-d14",
  });
  const digest = await imageDigest("untrained-d14");
  const cell = async () =>
    (await experimentRecordsDetail(experiment.id))!.images.find(
      (image) => image.digest === digest,
    )!;

  expect((await cell()).state).toBe("unread");
  expect((await cell()).detectionTally).toBeNull();

  const image = (await experimentObservationImageDetail({
    experiment: experiment.id,
    observationImage: (await cell()).id,
  }))!;
  expect(image.model.id).toBe(model.id);
  expect(image.review.detection).toBeNull();

  await storeAnnotation(
    { digest, modelId: model.id },
    [
      {
        id: "a",
        class: "rooted",
        bbox: { x: 2, y: 3, width: 4, height: 5 },
      },
      {
        id: "b",
        class: "rooted",
        bbox: { x: 9, y: 3, width: 4, height: 5 },
      },
    ],
    null,
  );
  expect((await cell()).annotationTally).toEqual({ rooted: 2 });
});
