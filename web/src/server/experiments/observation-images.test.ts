import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import {
  ExperimentObservationImageAlreadyUsedError,
  ObservationImageRejectedError,
  UnitNotFoundError,
} from "../../domain/experiments/errors";
import { ImageNotFoundError } from "../../domain/images/errors";
import { SEED_DETECTOR } from "../../domain/models/builtins";
import { collectImages } from "../images/collection";
import { imageBlobKey } from "../images/keys";
import { clearImageUnclear, markImageUnclear } from "../images/unclear";
import { blobExists } from "../infra/blobs/store";
import { database } from "../infra/db/client";
import { inferenceOutcomes } from "../infra/db/schema";
import { imageDigest, storeTexts } from "../testing/fixtures";
import {
  seedDetectionResult,
  seedInferenceTaskFailure,
} from "../testing/inference";
import { readExperimentObservationImage } from "./observation-image";
import {
  assignObservationImages,
  retryObservationImageAnalysis,
  unassignObservationImage,
} from "./observation-images";
import { createObservation } from "./observations";
import { readExperimentGrid, readUnit } from "./queries";
import {
  assignImages,
  createExperiment,
  failureFor,
  INOCULATED,
  imagesByUnit,
  reading,
  resultFor,
  trainedVersion,
  unitsOf,
  worker,
} from "./testing";

test("image assignment rejects duplicate units and reused images", async () => {
  const version = await trainedVersion("exp-assignment");
  const experiment = await createExperiment({
    name: "Image assignment",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "A", replicates: 2 }],
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
  const [first, other] = await storeTexts(["f-a1", "f-a2"]);

  await expect(
    assignObservationImages({
      experiment: experiment.id,
      observation: day7.id,
      images: [
        {
          unit: units.get("A-1")!,
          digest: first!,
          filename: "one.jpg",
        },
        {
          unit: units.get("A-1")!,
          digest: other!,
          filename: "two.jpg",
        },
      ],
    }),
  ).rejects.toThrow(ObservationImageRejectedError);
  await expect(
    assignObservationImages({
      experiment: experiment.id,
      observation: day7.id,
      images: [
        {
          unit: units.get("A-1")!,
          digest: first!,
          filename: "one.jpg",
        },
        {
          unit: units.get("A-2")!,
          digest: first!,
          filename: "two.jpg",
        },
      ],
    }),
  ).rejects.toThrow(ObservationImageRejectedError);
  await expect(
    assignObservationImages({
      experiment: experiment.id,
      observation: day7.id,
      images: [
        {
          unit: randomUUID(),
          digest: first!,
          filename: "one.jpg",
        },
      ],
    }),
  ).rejects.toThrow(UnitNotFoundError);

  const assigned = await assignObservationImages({
    experiment: experiment.id,
    observation: day7.id,
    images: [
      {
        unit: units.get("A-1")!,
        digest: first!,
        filename: "IMG_0413.jpg",
      },
    ],
  });
  expect([assigned.assigned, assigned.observation.id]).toEqual([1, day7.id]);

  try {
    await assignObservationImages({
      experiment: experiment.id,
      observation: day14.id,
      images: [
        {
          unit: units.get("A-2")!,
          digest: first!,
          filename: "reuse.jpg",
        },
      ],
    });
    throw new Error("Expected reused image to be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(ExperimentObservationImageAlreadyUsedError);
    expect(
      (error as ExperimentObservationImageAlreadyUsedError).images,
    ).toEqual([
      {
        digest: first!,
        filename: "IMG_0413.jpg",
        unit: "A-1",
        observedOn: "2026-08-08",
      },
    ]);
  }
  expect((await readExperimentGrid(experiment.id))?.images).toHaveLength(1);
});

test("a filled cell can be given a different image", async () => {
  const version = await trainedVersion("exp-replace");
  const experiment = await createExperiment({
    name: "Replace image",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "A", replicates: 2 }],
  });
  const units = await unitsOf(experiment.id);
  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });
  const [first, other, third] = await storeTexts(["r-a1", "r-a2", "r-a3"]);

  await assignObservationImages({
    experiment: experiment.id,
    observation: day7.id,
    images: [
      {
        unit: units.get("A-1")!,
        digest: first!,
        filename: "first.jpg",
      },
      {
        unit: units.get("A-2")!,
        digest: other!,
        filename: "other.jpg",
      },
    ],
  });

  await expect(
    assignObservationImages({
      experiment: experiment.id,
      observation: day7.id,
      images: [
        {
          unit: units.get("A-1")!,
          digest: other!,
          filename: "stolen.jpg",
        },
      ],
    }),
  ).rejects.toThrow(ExperimentObservationImageAlreadyUsedError);

  expect(
    (
      await assignObservationImages({
        experiment: experiment.id,
        observation: day7.id,
        images: [
          {
            unit: units.get("A-1")!,
            digest: third!,
            filename: "third.jpg",
          },
        ],
      })
    ).assigned,
  ).toBe(1);

  const grid = await readExperimentGrid(experiment.id);
  const byUnit = new Map(grid!.images.map((image) => [image.unit, image]));
  expect(byUnit.get(units.get("A-1")!)?.digest).toBe(third);
  expect(byUnit.get(units.get("A-1")!)?.filename).toBe("third.jpg");
  expect(byUnit.get(units.get("A-2")!)?.digest).toBe(other);
  expect(await blobExists(imageBlobKey(first!))).toBeTrue();

  await assignObservationImages({
    experiment: experiment.id,
    observation: day7.id,
    images: [
      {
        unit: units.get("A-2")!,
        digest: first!,
        filename: "moved.jpg",
      },
    ],
  });
  const after = await readExperimentGrid(experiment.id);
  const afterByUnit = new Map(
    after!.images.map((image) => [image.unit, image]),
  );
  expect(afterByUnit.get(units.get("A-1")!)?.digest).toBe(third);
  expect(afterByUnit.get(units.get("A-2")!)?.digest).toBe(first);
});

test("a photograph found unclear is marked on its image, wherever it is shown", async () => {
  const version = await trainedVersion("exp-unclear");
  const experiment = await createExperiment({
    name: "Unclear",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "A", replicates: 2 }],
  });
  // Unclear photographs do not count unless the experiment says so.
  expect(experiment.countsUnclear).toBe(false);
  const units = await unitsOf(experiment.id);
  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });
  const [fogged, clear] = await storeTexts(["u-a1", "u-a2"]);
  // A photograph known to be unclear is marked as it is placed.
  await assignObservationImages({
    experiment: experiment.id,
    observation: day7.id,
    images: [
      {
        unit: units.get("A-1")!,
        digest: fogged!,
        filename: "fogged.jpg",
        unclear: true,
      },
      { unit: units.get("A-2")!, digest: clear!, filename: "clear.jpg" },
    ],
  });
  const cellOf = async (id: string, unit: string) =>
    (await readExperimentGrid(id))!.images.find(
      (image) => image.unit === unit,
    )!;
  expect((await cellOf(experiment.id, units.get("A-1")!)).unclear).toBe(true);
  expect((await cellOf(experiment.id, units.get("A-2")!)).unclear).toBe(false);
  const page = await readUnit({
    experiment: experiment.id,
    unit: units.get("A-1")!,
  });
  expect(page?.shown?.unclear).toBe(true);
  expect(page?.observations[0]?.image?.unclear).toBe(true);

  // Marking again is harmless; the image is not read again.
  expect(await markImageUnclear({ digest: fogged! })).toEqual({
    digest: fogged,
    marked: false,
  });

  // The mark is the image's: another experiment showing it shows the mark.
  const other = await createExperiment({
    name: "Unclear elsewhere",
    inoculatedOn: INOCULATED,
    countsUnclear: true,
  });
  expect(other.countsUnclear).toBe(true);
  const otherUnits = await unitsOf(other.id);
  const otherDay = await createObservation({
    experiment: other.id,
    observedOn: "2026-08-09",
    note: "",
    ...reading(version),
  });
  await assignObservationImages({
    experiment: other.id,
    observation: otherDay.id,
    images: [
      { unit: otherUnits.get("A-1")!, digest: fogged!, filename: "f.jpg" },
    ],
  });
  expect((await cellOf(other.id, otherUnits.get("A-1")!)).unclear).toBe(true);

  // Clearing makes it clear again, and clearing twice is harmless.
  expect(await clearImageUnclear({ digest: fogged! })).toEqual({
    digest: fogged,
    cleared: true,
  });
  expect(await clearImageUnclear({ digest: fogged! })).toEqual({
    digest: fogged,
    cleared: false,
  });
  expect((await cellOf(experiment.id, units.get("A-1")!)).unclear).toBe(false);

  const unknown = "f".repeat(64);
  await expect(markImageUnclear({ digest: unknown })).rejects.toThrow(
    ImageNotFoundError,
  );
  await expect(clearImageUnclear({ digest: unknown })).rejects.toThrow(
    ImageNotFoundError,
  );
});

test("an unclear mark keeps no image alive", async () => {
  const [loose] = await storeTexts(["unclear-loose"]);
  await markImageUnclear({ digest: loose! });
  const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  expect(await collectImages(later)).toContain(loose!);
});

test("an assignment can be unassigned and the image given to another unit", async () => {
  const version = await trainedVersion("exp-unassign");
  const experiment = await createExperiment({
    name: "Refile",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "A", replicates: 2 }],
  });
  const units = await unitsOf(experiment.id);
  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });
  const [first, other] = await storeTexts(["w-a1", "w-a2"]);
  await assignObservationImages({
    experiment: experiment.id,
    observation: day7.id,
    images: [
      {
        unit: units.get("A-1")!,
        digest: first!,
        filename: "A-1.jpg",
      },
      {
        unit: units.get("A-2")!,
        digest: other!,
        filename: "A-2.jpg",
      },
    ],
  });
  const images = await imagesByUnit(experiment.id);

  await expect(
    assignObservationImages({
      experiment: experiment.id,
      observation: day7.id,
      images: [
        {
          unit: units.get("A-2")!,
          digest: first!,
          filename: "A-1.jpg",
        },
      ],
    }),
  ).rejects.toThrow(ExperimentObservationImageAlreadyUsedError);

  await unassignObservationImage({
    experiment: experiment.id,
    observationImage: images.get("A-2")!,
  });
  await unassignObservationImage({
    experiment: experiment.id,
    observationImage: images.get("A-1")!,
  });
  await assignObservationImages({
    experiment: experiment.id,
    observation: day7.id,
    images: [
      {
        unit: units.get("A-2")!,
        digest: first!,
        filename: "A-1.jpg",
      },
    ],
  });

  const grid = await readExperimentGrid(experiment.id);
  expect(grid?.images.map((image) => image.unit)).toEqual([units.get("A-2")!]);
  expect(await blobExists(imageBlobKey(await imageDigest("w-a2")))).toBeTrue();
});

test("analyzes images for the observation's model and exposes tallies", async () => {
  const version = await trainedVersion("exp-metrics");
  const experiment = await createExperiment({
    name: "Metrics",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "D", replicates: 2 }],
  });
  const units = await unitsOf(experiment.id);
  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });
  await assignImages(experiment.id, day7.id, units, {
    "D-1": "c-d1",
    "D-2": "c-d2",
  });
  const d1 = await imageDigest("c-d1");
  const d2 = await imageDigest("c-d2");

  const stateOf = async (digest: string) =>
    (await readExperimentGrid(experiment.id))?.images.find(
      (image) => image.digest === digest,
    )?.state;
  expect([await stateOf(d1), await stateOf(d2)]).toEqual([
    "pending",
    "pending",
  ]);

  await seedDetectionResult(
    { versionId: version.id, digest: d1 },
    resultFor(version, d1, 3),
    worker,
  );
  await seedInferenceTaskFailure(
    { versionId: version.id, digest: d2 },
    "no unit found",
  );
  const grid = await readExperimentGrid(experiment.id);
  const codes = new Map(grid!.units.map((unit) => [unit.id, unit.code]));
  expect(
    grid?.images
      .map((image) => [
        codes.get(image.unit)!,
        image.state,
        image.detectionTally,
        image.error,
      ])
      .sort(),
  ).toEqual([
    ["D-1", "analyzed", { ungerminated: 3 }, null],
    ["D-2", "failed", null, "no unit found"],
  ]);

  const images = await imagesByUnit(experiment.id);
  const failed = {
    experiment: experiment.id,
    observationImage: images.get("D-2")!,
  };
  await retryObservationImageAnalysis(failed);
  expect(await stateOf(d2)).toBe("pending");
  expect((await readExperimentObservationImage(failed))?.failure).toBeNull();
  expect(
    (await readExperimentObservationImage(failed))?.observation.observedOn,
  ).toBe("2026-08-08");
  expect((await readExperimentObservationImage(failed))?.unit.code).toBe("D-2");
  expect(
    (
      await readExperimentObservationImage({
        experiment: experiment.id,
        observationImage: images.get("D-1")!,
      })
    )?.review.detection?.instances,
  ).toHaveLength(3);
});

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
    resultFor(version, digest!, 1),
    worker,
  );
  expect(await states()).toEqual(["analyzed", "analyzed"]);
});

test("the database refuses execution failures in the detection results", async () => {
  const version = await trainedVersion("exp-failure-fk");
  const [digest] = await storeTexts(["failure-fk"]);
  const failure = failureFor(version, digest!);

  const invalidFailure = (async () => {
    await (await database()).insert(inferenceOutcomes).values({
      imageId: digest!,
      modelVersionId: version.id,
      document: {
        ...failure,
        producer: failure.producer,
      } as never,
      recordedAt: new Date(),
    });
  })();
  await expect(invalidFailure).rejects.toThrow();
});

test("an experiment observation image is a garbage-collection root", async () => {
  const version = await trainedVersion("exp-gc");
  const experiment = await createExperiment({
    name: "GC",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "E", replicates: 1 }],
  });
  const units = await unitsOf(experiment.id);
  const observation = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });
  await assignImages(experiment.id, observation.id, units, {
    "E-1": "gc-e1",
  });
  const kept = await imageDigest("gc-e1");
  const [loose] = await storeTexts(["gc-loose"]);
  const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const collected = await collectImages(later);

  expect(collected).toContain(loose!);
  expect(collected).not.toContain(kept);
  expect(await blobExists(imageBlobKey(kept))).toBeTrue();
});
