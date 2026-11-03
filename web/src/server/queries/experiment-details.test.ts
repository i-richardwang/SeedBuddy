import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { SEED_DETECTOR } from "../../domain/models/builtins";
import { storeAnnotation } from "../annotations/documents";
import { assignObservationImages } from "../experiments/observation-images";
import { createObservation } from "../experiments/observations";
import { createModel } from "../models/registry";
import { experimentGridDetail } from "../queries/experiment-grid-detail";
import { experimentObservationImageDetail } from "../queries/experiment-observation-image-detail";
import { unitDetail } from "../queries/unit-detail";
import {
  assignImages,
  createExperiment,
  INOCULATED,
  reading,
  unitsOf,
} from "../testing/experiments";
import { countedImageResult, imageDigest, storeTexts } from "../testing/images";
import { seedDetectionResult } from "../testing/inference";
import { trainedVersion } from "../testing/models";
import { ultralyticsWorker as worker } from "../testing/workers";

test("a unit page shows its newest image and steps through units on its day", async () => {
  const version = await trainedVersion("exp-observation-unit");
  const experiment = await createExperiment({
    name: "Unit series",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "S", replicates: 2 }],
  });
  const units = await unitsOf(experiment.id);
  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });
  const day14 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-15",
    note: "",
    ...reading(version),
  });
  await assignImages(experiment.id, day7.id, units, {
    "S-1": "s-d1-s1",
    "S-2": "s-d1-s2",
  });
  await assignImages(experiment.id, day14.id, units, {
    "S-1": "s-d3-s1",
  });
  const ref = {
    experiment: experiment.id,
    unit: units.get("S-1")!,
  };

  const newest = await unitDetail(ref);
  expect(newest?.shown?.model.classes).toEqual(SEED_DETECTOR.classes);
  expect(newest?.shown?.observation.id).toBe(day14.id);
  expect(newest?.observations.map((item) => item.image?.state ?? null)).toEqual(
    ["pending", "pending"],
  );
  // Each day's photograph carries its size, to be framed beside another.
  const latest = newest?.observations[1]?.image;
  expect(latest && [latest.width, latest.height]).toEqual([
    newest!.shown!.review.width,
    newest!.shown!.review.height,
  ]);
  expect(newest?.observation).toBe(day14.id);
  expect(newest?.navigation.map((item) => [item.code, item.image])).toEqual([
    ["S-1", "unreviewed"],
    ["S-2", null],
  ]);

  const earlier = await unitDetail(ref, day7.id);
  expect(earlier?.shown?.review.ref.digest).toBe(await imageDigest("s-d1-s1"));

  const lonely = await unitDetail({
    ...ref,
    unit: units.get("S-2")!,
  });
  expect(lonely?.shown?.observation.id).toBe(day7.id);
  expect(lonely?.observations[1]?.image).toBeNull();
  const missing = await unitDetail(
    { ...ref, unit: units.get("S-2")! },
    day14.id,
  );
  expect(missing?.observation).toBe(day14.id);
  expect(missing?.shown).toBeNull();
  expect(await unitDetail(ref, randomUUID())).toBeNull();
  expect(
    await unitDetail({
      ...ref,
      unit: randomUUID(),
    }),
  ).toBeNull();
});

test("two experiments analyzing one image with one version share one inference", async () => {
  const version = await trainedVersion("exp-shared");
  const [digest] = await storeTexts(["shared-image"]);
  const experimentIds: string[] = [];
  for (const name of ["Shared demand A", "Shared demand B"]) {
    const experiment = await createExperiment({
      name,
      inoculatedOn: INOCULATED,
      treatments: [{ name: "S", replicates: 1 }],
    });
    const units = await unitsOf(experiment.id);
    const observation = await createObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    await assignObservationImages({
      experiment: experiment.id,
      observation: observation.id,
      images: [
        {
          unit: units.get("S-1")!,
          digest: digest!,
          filename: "S1.jpg",
        },
      ],
    });
    experimentIds.push(experiment.id);
  }

  const states = async () =>
    Promise.all(
      experimentIds.map(
        async (id) => (await experimentGridDetail(id))?.images[0]?.state,
      ),
    );
  expect(await states()).toEqual(["pending", "pending"]);

  await seedDetectionResult(
    { versionId: version.id, digest: digest! },
    countedImageResult(version, digest!, 1),
    worker,
  );
  expect(await states()).toEqual(["analyzed", "analyzed"]);
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
    (await experimentGridDetail(experiment.id))!.images.find(
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
