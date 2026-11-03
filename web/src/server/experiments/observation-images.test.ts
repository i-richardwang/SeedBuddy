import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import {
  ExperimentObservationImageConflictError,
  ObservationImageConflictError,
  UnitNotFoundError,
} from "../../domain/experiments/errors";
import { imageBlobKey } from "../images/keys";
import { blobExists } from "../infra/blobs/store";
import { imageDigest, storeTexts } from "../testing/images";
import {
  seedDetectionResult,
  seedInferenceTaskFailure,
} from "../testing/inference";
import { readExperimentObservationImage } from "./observation-image";
import {
  assignObservationImages,
  recordObservation,
  retryObservationImageAnalysis,
  unassignObservationImage,
} from "./observation-images";
import { createObservation } from "./observations";
import { readExperimentGrid } from "./queries";
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
  ).rejects.toThrow(ObservationImageConflictError);
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
  ).rejects.toThrow(ObservationImageConflictError);
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
    expect(error).toBeInstanceOf(ExperimentObservationImageConflictError);
    expect((error as ExperimentObservationImageConflictError).images).toEqual([
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
  ).rejects.toThrow(ExperimentObservationImageConflictError);

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
  const imageGrid = (await readExperimentGrid(experiment.id))!;
  const unitCodes = new Map(
    imageGrid.units.map((unit) => [unit.id, unit.code]),
  );
  const images = new Map(
    imageGrid.images.map((image) => [unitCodes.get(image.unit)!, image.id]),
  );

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
  ).rejects.toThrow(ExperimentObservationImageConflictError);

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
    countedImageResult(version, d1, 3),
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

  const imageGrid = (await readExperimentGrid(experiment.id))!;
  const unitCodes = new Map(
    imageGrid.units.map((unit) => [unit.id, unit.code]),
  );
  const images = new Map(
    imageGrid.images.map((image) => [unitCodes.get(image.unit)!, image.id]),
  );
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

test("an observation day is recorded with its photographs, or not at all", async () => {
  const version = await trainedVersion("exp-record");
  const experiment = await createExperiment({
    name: "Record",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "A", replicates: 2 }],
  });
  const units = await unitsOf(experiment.id);
  const [first, second] = await storeTexts(["record-a1", "record-a2"]);

  const day = await recordObservation({
    experiment: experiment.id,
    observedOn: "2026-08-07",
    note: "",
    ...reading(version),
    images: [
      { unit: units.get("A-1")!, digest: first!, filename: "A-1.jpg" },
      { unit: units.get("A-2")!, digest: second!, filename: "A-2.jpg" },
    ],
  });
  expect(day.hasRecords).toBeTrue();
  const grid = await readExperimentGrid(experiment.id);
  expect(grid?.observations.map((item) => item.id)).toEqual([day.id]);
  expect(grid?.images.map((image) => image.observation)).toEqual([
    day.id,
    day.id,
  ]);

  await expect(
    recordObservation({
      experiment: experiment.id,
      observedOn: "2026-08-14",
      note: "",
      ...reading(version),
      images: [
        { unit: units.get("A-1")!, digest: first!, filename: "A-1.jpg" },
      ],
    }),
  ).rejects.toThrow(ExperimentObservationImageConflictError);
  expect(
    (await readExperimentGrid(experiment.id))?.observations,
    "a refused photograph leaves no empty day behind",
  ).toHaveLength(1);
});
