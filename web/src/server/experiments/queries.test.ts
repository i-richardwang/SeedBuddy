import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { SEED_DETECTOR } from "../../domain/models/builtins";
import { imageDigest, storeTexts } from "../testing/images";
import { seedDetectionResult } from "../testing/inference";
import { assignObservationImages } from "./observation-images";
import { createObservation } from "./observations";
import { readExperimentGrid, readUnit } from "./queries";
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

  const newest = await readUnit(ref);
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

  const earlier = await readUnit(ref, day7.id);
  expect(earlier?.shown?.review.ref.digest).toBe(await imageDigest("s-d1-s1"));

  const lonely = await readUnit({
    ...ref,
    unit: units.get("S-2")!,
  });
  expect(lonely?.shown?.observation.id).toBe(day7.id);
  expect(lonely?.observations[1]?.image).toBeNull();
  const missing = await readUnit({ ...ref, unit: units.get("S-2")! }, day14.id);
  expect(missing?.observation).toBe(day14.id);
  expect(missing?.shown).toBeNull();
  expect(await readUnit(ref, randomUUID())).toBeNull();
  expect(
    await readUnit({
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
        async (id) => (await readExperimentGrid(id))?.images[0]?.state,
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
