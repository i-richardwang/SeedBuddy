import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { SEED_DETECTOR } from "../../domain/models/builtins";
import { createObservation } from "../experiments/observations";
import {
  assignImages,
  createExperiment,
  INOCULATED,
  reading,
  unitsOf,
} from "../testing/experiments";
import { imageDigest } from "../testing/images";
import { trainedVersion } from "../testing/models";
import { unitDetail } from "./unit-detail";

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
