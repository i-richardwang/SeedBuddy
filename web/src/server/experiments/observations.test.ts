import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { instancesFromDetection } from "../../domain/annotation/detection";
import {
  ObservationConflictError,
  UnitConflictError,
} from "../../domain/experiments/errors";
import { SEED_DETECTOR } from "../../domain/models/builtins";
import {
  ClassInvalidError,
  ModelNotFoundError,
} from "../../domain/models/errors";
import { storeAnnotation } from "../annotations/documents";
import { database } from "../infra/db/client";
import { experimentObservations } from "../infra/db/schema";
import { createModel, readModel, setModelSettings } from "../models/registry";
import { experimentObservationImageDetail } from "../queries/experiment-observation-image-detail";
import { experimentRecordsDetail } from "../queries/experiment-records-detail";
import { listExperimentOverviews } from "../queries/list-experiment-overviews";
import {
  assignImages,
  createExperiment,
  INOCULATED,
  reading,
  unitsOf,
} from "../testing/experiments";
import { countedImageResult, imageDigest } from "../testing/images";
import { seedDetectionResult } from "../testing/inference";
import { baselineVersion, trainedVersion } from "../testing/models";
import { ultralyticsWorker as worker } from "../testing/workers";
import { recordCultureEvents } from "./culture-events";
import { deleteExperiment } from "./design";
import { recordManualReadings } from "./manual-readings";
import {
  createObservation,
  deleteObservation,
  updateObservation,
} from "./observations";

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
    countedClasses: (await readModel(traditional.modelId, await database()))!
      .classes,
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

test("an observation counts the classes its model counts by default, and keeps them when the default changes", async () => {
  // A seed without an embryo was never going to germinate.
  const seeds = (await readModel(SEED_DETECTOR.id, await database()))!;
  expect(seeds.countedClasses).toEqual(["ungerminated", "germinated", "dead"]);

  const model = await createModel({
    id: "counted-by-default",
    name: "Counted by default",
    classes: ["seed", "germinated", "empty"],
    countedClasses: ["seed", "germinated"],
  });
  const experiment = await createExperiment({
    name: "Counted by default",
    inoculatedOn: INOCULATED,
  });
  const day = (observedOn: string) =>
    createObservation({
      experiment: experiment.id,
      observedOn,
      note: "",
      modelId: model.id,
    });
  const sown = await day("2026-08-01");
  expect(sown.countedClasses).toEqual(["seed", "germinated"]);

  await setModelSettings({
    model: model.id,
    countedClasses: model.classes,
    area: model.area,
    annotation: model.annotation,
  });
  expect((await day("2026-08-08")).countedClasses).toEqual(model.classes);
  const records = (await experimentRecordsDetail(experiment.id))!;
  expect(records.observations[0]!.countedClasses).toEqual([
    "seed",
    "germinated",
  ]);
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
  ).rejects.toThrow(ClassInvalidError);
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
  expect(reordered.countedClasses).toEqual(["ungerminated", "germinated"]);

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

test("observations of one experiment read with different models", async () => {
  const callus = await trainedVersion("exp-stage-callus", ["callus"]);
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
  const records = (await experimentRecordsDetail(experiment.id))!;
  expect(
    records.observations.map((item) => [item.observedOn, item.modelId]),
  ).toEqual([
    ["2026-08-08", callus.modelId],
    ["2026-08-15", seeds.modelId],
  ]);
  const ref = {
    experiment: experiment.id,
    observationImage: records.images.find((image) => image.digest === digest)!
      .id,
  };
  const cell = async () =>
    (await experimentRecordsDetail(experiment.id))!.images.find(
      (image) => image.digest === digest,
    )!;
  const reread = async (modelId: string) =>
    updateObservation({
      experiment: experiment.id,
      observation: day14.id,
      observedOn: day14.observedOn,
      note: day14.note,
      modelId,
      countedClasses: (await readModel(modelId, await database()))!.classes,
    });

  const found = countedImageResult(seeds, digest, 2);
  await seedDetectionResult({ versionId: seeds.id, digest }, found, worker);
  await storeAnnotation(
    { digest, modelId: seeds.modelId },
    instancesFromDetection(found),
    null,
  );
  expect((await cell()).state).toBe("analyzed");
  const before = (await experimentObservationImageDetail(ref))!;
  expect(before.model.id).toBe(seeds.modelId);
  expect(before.review.detection?.instances).toHaveLength(2);
  expect(before.review.annotation).not.toBeNull();

  await reread(callus.modelId);
  expect((await cell()).state).toBe("pending");
  const switched = (await experimentObservationImageDetail(ref))!;
  expect(switched.model.id).toBe(callus.modelId);
  expect(switched.review.detection).toBeNull();
  expect(switched.review.annotation).toBeNull();

  await reread(seeds.modelId);
  expect((await cell()).state).toBe("analyzed");
  const restored = (await experimentObservationImageDetail(ref))!;
  expect(restored.review.detection).toEqual(before.review.detection);
  expect(restored.review.annotation).toEqual(before.review.annotation);
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
  expect(await experimentRecordsDetail(experiment.id)).toBeNull();
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
  ).rejects.toThrow(ObservationConflictError);

  await assignImages(experiment.id, day7.id, units, {
    "A-2": "s-a2-7",
    "A-10": "s-a10-7",
    "B-1": "s-b1-7",
  });
  await assignImages(experiment.id, day14.id, units, {
    "A-2": "s-a2-14",
  });

  const records = await experimentRecordsDetail(experiment.id);
  expect(
    records?.observations.map(({ id, observedOn }) => [id, observedOn]),
  ).toEqual([
    [day7.id, "2026-08-08"],
    [day14.id, "2026-08-15"],
    [day21.id, "2026-08-22"],
  ]);
  expect(records?.units.map((unit) => unit.code)).toEqual([
    ...Array.from({ length: 10 }, (_, index) => `A-${index + 1}`),
    "B-1",
  ]);
  expect(records?.images).toHaveLength(4);

  const summary = (await listExperimentOverviews()).find(
    ({ experiment: item }) => item.id === experiment.id,
  );
  expect(summary?.units).toBe(11);
  expect(summary?.observations).toBe(3);
  expect(summary?.lastObservedOn).toBe("2026-08-22");
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
  ).rejects.toThrow(ObservationConflictError);
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
        /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
        createdAt: new Date(),
      });
    })(),
  ).rejects.toThrow();
});

test("observation dates can be corrected and empty days removed", async () => {
  const version = await trainedVersion("exp-date-edits");
  const experiment = await createExperiment({
    name: "Observation date edits",
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
  await assignImages(experiment.id, day7.id, units, {
    "A-1": "date-edit-1",
    "A-2": "date-edit-2",
  });
  await expect(
    updateObservation({
      experiment: experiment.id,
      observation: day14.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
      countedClasses: day14.countedClasses,
    }),
  ).rejects.toThrow(ObservationConflictError);
  const redatedEmpty = await updateObservation({
    experiment: experiment.id,
    observation: day14.id,
    observedOn: "2026-08-29",
    note: "Final count",
    ...reading(version),
    countedClasses: day14.countedClasses,
  });
  expect([redatedEmpty.observedOn, redatedEmpty.note]).toEqual([
    "2026-08-29",
    "Final count",
  ]);
  const redatedRecorded = await updateObservation({
    experiment: experiment.id,
    observation: day7.id,
    observedOn: "2026-08-09",
    note: "Images checked",
    ...reading(version),
    countedClasses: day7.countedClasses,
  });
  expect([redatedRecorded.observedOn, redatedRecorded.note]).toEqual([
    "2026-08-09",
    "Images checked",
  ]);
  expect((await experimentRecordsDetail(experiment.id))?.images).toHaveLength(
    2,
  );

  await deleteObservation({
    experiment: experiment.id,
    observation: day14.id,
  });
  await expect(
    deleteObservation({ experiment: experiment.id, observation: day7.id }),
  ).rejects.toThrow(ObservationConflictError);
});

test("correcting dates cannot move records beyond a unit's removal", async () => {
  const version = await trainedVersion("date-lifetime");
  const experiment = await createExperiment({
    name: "Date lifetime",
    inoculatedOn: INOCULATED,
  });
  const units = await unitsOf(experiment.id);
  const unit = units.get("A-1")!;
  const counted = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
    countedClasses: ["ungerminated", "germinated"],
  });
  const removed = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-15",
    note: "",
    ...reading(version),
  });
  await recordManualReadings({
    experiment: experiment.id,
    observation: counted.id,
    readings: [{ unit, tally: { ungerminated: 2, germinated: 3 } }],
  });
  await recordCultureEvents({
    experiment: experiment.id,
    units: [unit],
    observation: removed.id,
    type: "discarded",
  });
  for (const [observation, observedOn] of [
    [counted, "2026-08-20"],
    [removed, "2026-08-05"],
  ] as const) {
    await expect(
      updateObservation({
        experiment: experiment.id,
        observation: observation.id,
        observedOn,
        note: "",
        ...reading(version),
        countedClasses: observation.countedClasses,
      }),
    ).rejects.toThrow(UnitConflictError);
    const records = (await experimentRecordsDetail(experiment.id))!;
    expect(
      records.observations.find((item) => item.id === observation.id)!
        .observedOn,
    ).toBe(observation.observedOn);
  }
  const corrected = await updateObservation({
    experiment: experiment.id,
    observation: counted.id,
    observedOn: "2026-08-09",
    note: "",
    ...reading(version),
    countedClasses: counted.countedClasses,
  });
  expect(corrected.observedOn).toBe("2026-08-09");
});
