import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { SEED_DETECTOR } from "../../domain/models/builtins";
import { createObservation } from "../experiments/observations";
import {
  assignImages,
  createExperiment,
  INOCULATED,
  reading,
  unitSeries,
  unitsOf,
} from "../testing/experiments";
import { imageDigest } from "../testing/images";
import { trainedVersion } from "../testing/models";
import { unitWorkbench } from "./unit-workbench";

test("a unit page shows its newest image or the day asked, its place among the units, and whether it may go", async () => {
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

  const newest = await unitSeries(ref);
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
  // S-1 awaits review on its newest day; S-2 has no photograph that day.
  expect(newest?.navigation).toMatchObject({
    treatment: null,
    position: 1,
    total: 2,
    previous: null,
    next: { id: units.get("S-2")!, code: "S-2" },
    nextToReview: null,
    toReview: 0,
  });
  const second = await unitSeries(
    { ...ref, unit: units.get("S-2")! },
    { observation: day7.id },
  );
  expect(second?.navigation).toMatchObject({
    position: 2,
    previous: { id: units.get("S-1")!, code: "S-1" },
    next: null,
  });
  // S-2 has a photograph, so it stays.
  expect(second?.removable).toBeFalse();

  const earlier = await unitSeries(ref, { observation: day7.id });
  expect(earlier?.shown?.review.ref.digest).toBe(await imageDigest("s-d1-s1"));

  const lonely = await unitSeries({
    ...ref,
    unit: units.get("S-2")!,
  });
  expect(lonely?.shown?.observation.id).toBe(day7.id);
  expect(lonely?.observations[1]?.image).toBeNull();
  const missing = await unitSeries(
    { ...ref, unit: units.get("S-2")! },
    { observation: day14.id },
  );
  expect(missing?.observation).toBe(day14.id);
  expect(missing?.shown).toBeNull();
  expect(await unitSeries(ref, { observation: randomUUID() })).toBeNull();
  expect(
    await unitSeries({
      ...ref,
      unit: randomUUID(),
    }),
  ).toBeNull();
});

test("the next unit to review is the first after this one, then around again", async () => {
  const version = await trainedVersion("exp-review-queue");
  const experiment = await createExperiment({
    name: "Review queue",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "Q", replicates: 4 }],
  });
  const units = await unitsOf(experiment.id);
  const day = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });
  // Q-3 has no photograph, so nothing of it awaits review.
  await assignImages(experiment.id, day.id, units, {
    "Q-1": "queue-q1",
    "Q-2": "queue-q2",
    "Q-4": "queue-q4",
  });
  const queue = async (code: string) =>
    (
      await unitSeries(
        { experiment: experiment.id, unit: units.get(code)! },
        { observation: day.id },
      )
    )?.navigation;
  expect(await queue("Q-2")).toMatchObject({
    toReview: 2,
    nextToReview: { code: "Q-4" },
  });
  expect(await queue("Q-4")).toMatchObject({
    toReview: 2,
    nextToReview: { code: "Q-1" },
  });
  expect(await queue("Q-3")).toMatchObject({
    toReview: 3,
    nextToReview: { code: "Q-4" },
  });
});

test("a treatment the unit is not of gives way to every unit", async () => {
  const experiment = await createExperiment({
    name: "Stepping",
    inoculatedOn: INOCULATED,
    treatments: [
      { name: "A", replicates: 2 },
      { name: "B", replicates: 1 },
    ],
  });
  const units = await unitsOf(experiment.id);
  const ref = { experiment: experiment.id, unit: units.get("A-2")! };
  const of = await unitSeries(ref);
  const a = of!.unit.treatment;
  const b = of!.treatments.find((treatment) => treatment.id !== a)!.id;
  expect((await unitSeries(ref, { treatment: a }))?.navigation).toMatchObject({
    treatment: a,
    position: 2,
    total: 2,
    next: null,
  });
  expect(await unitWorkbench(ref, { treatment: b })).toEqual({
    instead: { treatment: null },
  });
  expect(of?.navigation).toMatchObject({
    treatment: null,
    position: 2,
    total: 3,
    next: { code: "B-1" },
  });
});
