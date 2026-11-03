import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { instancesFromDetection } from "../../domain/annotation/detection";
import {
  ExperimentObservationImageAlreadyUsedError,
  ObservationRejectedError,
} from "../../domain/experiments/errors";
import { SEED_DETECTOR } from "../../domain/models/builtins";
import {
  ModelNotFoundError,
  UnknownClassError,
} from "../../domain/models/errors";
import { DEFAULT_MODEL_ANNOTATION } from "../../domain/models/schema";
import { storeAnnotation } from "../annotations/documents";
import { database } from "../infra/db/client";
import { experimentObservations } from "../infra/db/schema";
import { readModel } from "../models/public";
import {
  createModel,
  registerModel,
  setCurrentVersion,
} from "../models/registry";
import {
  baselineVersion,
  imageDigest,
  registerTrainedVersion,
  storeTexts,
} from "../testing/fixtures";
import { seedDetectionResult } from "../testing/inference";
import { deleteExperiment } from "./design";
import { readExperimentObservationImage } from "./observation-image";
import { recordObservation } from "./observation-images";
import { createObservation, updateObservation } from "./observations";
import { listExperiments, readExperimentGrid } from "./queries";
import {
  assignImages,
  createExperiment,
  INOCULATED,
  reading,
  resultFor,
  trainedVersion,
  unitsOf,
  worker,
} from "./testing";

test("an observation reads for a model the registry holds", async () => {
  const version = await trainedVersion("exp-reading");
  const experiment = await createExperiment({
    name: "CellReading",
    inoculatedOn: INOCULATED,
  });
  await expect(
    createObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      modelId: "nobody",
    }),
  ).rejects.toThrow(ModelNotFoundError);
  const observation = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });
  expect(observation.modelId).toBe(version.modelId);

  const traditional = await baselineVersion();
  const reread = await updateObservation({
    experiment: experiment.id,
    observation: observation.id,
    observedOn: observation.observedOn,
    note: observation.note,
    modelId: traditional.modelId,
    countedClasses: (await readModel(traditional.modelId))!.classes,
  });
  expect(reread.modelId).toBe(traditional.modelId);

  const unknownModel = (async () => {
    await (
      await database()
    )
      .update(experimentObservations)
      .set({ modelId: "nobody" })
      .where(eq(experimentObservations.id, observation.id));
  })();
  await expect(unknownModel).rejects.toThrow();
});

test("an observation counts the classes it names, in its model's order", async () => {
  const version = await trainedVersion("exp-counted");
  const experiment = await createExperiment({
    name: "Counted",
    inoculatedOn: INOCULATED,
  });
  const sown = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-01",
    note: "",
    ...reading(version),
  });
  expect(sown.countedClasses).toEqual([...SEED_DETECTOR.classes]);

  await expect(
    createObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
      countedClasses: ["germinated", "shoot"],
    }),
  ).rejects.toThrow(UnknownClassError);
  const germinated = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
    countedClasses: ["germinated"],
  });
  expect(germinated.countedClasses).toEqual(["germinated"]);

  const reordered = await updateObservation({
    experiment: experiment.id,
    observation: sown.id,
    observedOn: sown.observedOn,
    note: sown.note,
    ...reading(version),
    countedClasses: ["germinated", "ungerminated"],
  });
  expect(reordered.countedClasses).toEqual([...SEED_DETECTOR.classes]);

  const empty = (async () => {
    await (
      await database()
    )
      .update(experimentObservations)
      .set({ countedClasses: [] })
      .where(eq(experimentObservations.id, germinated.id));
  })();
  await expect(empty).rejects.toThrow();
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
    (await readExperimentGrid(experiment.id))!.images.find(
      (image) => image.digest === digest,
    )!;

  expect((await cell()).state).toBe("unread");
  expect((await cell()).detectionTally).toBeNull();

  const image = (await readExperimentObservationImage({
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

test("observations of one experiment read with different models", async () => {
  await registerModel({
    schemaVersion: 1,
    id: "exp-stage-callus",
    name: "Callus detector",
    task: "object_detection",
    classes: ["callus"],
    annotation: DEFAULT_MODEL_ANNOTATION,
  });
  const callus = await registerTrainedVersion("exp-stage-callus");
  await setCurrentVersion({ model: callus.modelId, version: callus.id });
  const seeds = await trainedVersion("exp-stage-seeds");
  const experiment = await createExperiment({
    name: "Stages",
    inoculatedOn: INOCULATED,
  });
  const units = await unitsOf(experiment.id);
  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(callus),
  });
  const day14 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-15",
    note: "",
    ...reading(seeds),
  });
  await assignImages(experiment.id, day7.id, units, { "A-1": "stage-d7" });
  await assignImages(experiment.id, day14.id, units, { "A-1": "stage-d14" });
  const digest = await imageDigest("stage-d14");
  const grid = (await readExperimentGrid(experiment.id))!;
  expect(
    grid.observations.map((item) => [item.observedOn, item.modelId]),
  ).toEqual([
    ["2026-08-08", callus.modelId],
    ["2026-08-15", seeds.modelId],
  ]);
  const ref = {
    experiment: experiment.id,
    observationImage: grid.images.find((image) => image.digest === digest)!.id,
  };
  const cell = async () =>
    (await readExperimentGrid(experiment.id))!.images.find(
      (image) => image.digest === digest,
    )!;
  const reread = async (modelId: string) =>
    updateObservation({
      experiment: experiment.id,
      observation: day14.id,
      observedOn: day14.observedOn,
      note: day14.note,
      modelId,
      countedClasses: (await readModel(modelId))!.classes,
    });

  const found = resultFor(seeds, digest, 2);
  await seedDetectionResult({ versionId: seeds.id, digest }, found, worker);
  await storeAnnotation(
    { digest, modelId: seeds.modelId },
    instancesFromDetection(found),
    null,
  );
  expect((await cell()).state).toBe("analyzed");
  const before = (await readExperimentObservationImage(ref))!;
  expect(before.model.id).toBe(seeds.modelId);
  expect(before.review.detection?.instances).toHaveLength(2);
  expect(before.review.annotation).not.toBeNull();

  await reread(callus.modelId);
  expect((await cell()).state).toBe("pending");
  const switched = (await readExperimentObservationImage(ref))!;
  expect(switched.model.id).toBe(callus.modelId);
  expect(switched.review.detection).toBeNull();
  expect(switched.review.annotation).toBeNull();

  await reread(seeds.modelId);
  expect((await cell()).state).toBe("analyzed");
  const restored = (await readExperimentObservationImage(ref))!;
  expect(restored.review.detection).toEqual(before.review.detection);
  expect(restored.review.annotation).toEqual(before.review.annotation);
});

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
    (await readExperimentGrid(experiment.id))!.images.find(
      (image) => image.digest === digest,
    )!;
  const ref = {
    experiment: experiment.id,
    observationImage: (await imageOf()).id,
  };
  await seedDetectionResult(
    { versionId: first.id, digest },
    resultFor(first, digest, 3),
    worker,
  );
  const read = (await readExperimentObservationImage(ref))!;
  expect(read.review.detection?.instances).toHaveLength(3);

  const next = await registerTrainedVersion("exp-retrained", "yolo-v2");
  expect((await imageOf()).state).toBe("analyzed");

  await setCurrentVersion({ model: "exp-retrained", version: next.id });
  expect((await imageOf()).state).toBe("pending");
  expect(
    (await readExperimentObservationImage(ref))!.review.detection?.instances,
  ).toHaveLength(3);

  await setCurrentVersion({ model: "exp-retrained", version: first.id });
  expect((await imageOf()).state).toBe("analyzed");
  expect((await imageOf()).detectionTally).toEqual({ ungerminated: 3 });
});

test("an observation can be scheduled before any image exists", async () => {
  const version = await trainedVersion("exp-planned-observation");
  const experiment = await createExperiment({
    name: "Planned observation",
    inoculatedOn: INOCULATED,
  });
  await expect(
    createObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    }),
  ).resolves.toMatchObject({ observedOn: "2026-08-08" });
  await expect(
    createObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
      ...reading(version),
    }),
  ).resolves.toMatchObject({ observedOn: "2026-08-15" });

  await deleteExperiment({ experiment: experiment.id });
  expect(await readExperimentGrid(experiment.id)).toBeNull();
});

test("observations are dated once and ordered by the day they happened", async () => {
  const version = await trainedVersion("exp-observations");
  const experiment = await createExperiment({
    name: "Series",
    inoculatedOn: INOCULATED,
    treatments: [
      { name: "A", replicates: 10 },
      { name: "B", replicates: 1 },
    ],
  });
  const units = await unitsOf(experiment.id);

  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "First look",
    ...reading(version),
  });
  expect([day7.ordinal, day7.observedOn, day7.note]).toEqual([
    1,
    "2026-08-08",
    "First look",
  ]);

  const day21 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-22",
    note: "",
    ...reading(version),
  });
  const day14 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-15",
    note: "",
    ...reading(version),
  });
  await expect(
    createObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
      ...reading(version),
    }),
  ).rejects.toThrow(ObservationRejectedError);

  await assignImages(experiment.id, day7.id, units, {
    "A-2": "s-a2-7",
    "A-10": "s-a10-7",
    "B-1": "s-b1-7",
  });
  await assignImages(experiment.id, day14.id, units, {
    "A-2": "s-a2-14",
  });

  const grid = await readExperimentGrid(experiment.id);
  expect(
    grid?.observations.map(({ id, observedOn }) => [id, observedOn]),
  ).toEqual([
    [day7.id, "2026-08-08"],
    [day14.id, "2026-08-15"],
    [day21.id, "2026-08-22"],
  ]);
  expect(grid?.units.map((unit) => unit.code)).toEqual([
    ...Array.from({ length: 10 }, (_, index) => `A-${index + 1}`),
    "B-1",
  ]);
  expect(grid?.images).toHaveLength(4);

  const summary = (await listExperiments()).find(
    ({ experiment: item }) => item.id === experiment.id,
  );
  expect(summary?.units).toBe(11);
  expect(summary?.observations).toBe(3);
  expect(summary?.lastObservedOn).toBe("2026-08-22");
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
  ).rejects.toThrow(ExperimentObservationImageAlreadyUsedError);
  expect(
    (await readExperimentGrid(experiment.id))?.observations,
    "a refused photograph leaves no empty day behind",
  ).toHaveLength(1);
});

test("observations cannot precede inoculation at either boundary", async () => {
  const version = await trainedVersion("exp-dates");
  const experiment = await createExperiment({
    name: "Dates",
    inoculatedOn: INOCULATED,
  });
  await expect(
    createObservation({
      experiment: experiment.id,
      observedOn: "2026-07-31",
      note: "",
      ...reading(version),
    }),
  ).rejects.toThrow(ObservationRejectedError);
  await expect(
    (async () => {
      await (await database()).insert(experimentObservations).values({
        experimentId: experiment.id,
        id: randomUUID(),
        inoculatedOn: INOCULATED,
        observedOn: "2026-07-31",
        ...reading(version),
        countedClasses: [...SEED_DETECTOR.classes],
        note: "",
        createdAt: new Date(),
      });
    })(),
  ).rejects.toThrow();
});
