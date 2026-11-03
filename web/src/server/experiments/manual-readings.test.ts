import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import {
  observationCells,
  unitReading,
} from "../../domain/experiments/cell-reading";
import {
  ManualReadingConflictError,
  ObservationConflictError,
  ObservationModelCountsConflictError,
  ObservationNotFoundError,
  UnitConflictError,
  UnitNotFoundError,
} from "../../domain/experiments/errors";
import { createModel } from "../models/registry";
import { imageDigest } from "../testing/images";
import { seedDetectionResult } from "../testing/inference";
import { recordCultureEvents } from "./culture-events";
import { deleteUnit } from "./design";
import { recordManualReadings } from "./manual-readings";
import {
  createObservation,
  deleteObservation,
  updateObservation,
} from "./observations";
import { experimentGridDetail, unitDetail } from "./queries";
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

test("a unit counted by hand has a number with no photograph, and the count outranks the photograph's", async () => {
  const version = await trainedVersion("exp-manual-counts");
  const experiment = await createExperiment({
    name: "Transplanting counts",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "A", replicates: 2 }],
  });
  const units = await unitsOf(experiment.id);
  const day0 = await createObservation({
    experiment: experiment.id,
    observedOn: INOCULATED,
    note: "",
    ...reading(version),
  });
  const day14 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-15",
    note: "",
    ...reading(version),
    countedClasses: ["germinated"],
  });
  await assignImages(experiment.id, day0.id, units, { "A-1": "m-a1" });
  const a1 = await imageDigest("m-a1");
  await seedDetectionResult(
    { versionId: version.id, digest: a1 },
    countedImageResult(version, a1, 3),
    worker,
  );

  // The day the seedlings were moved was never photographed; the counts
  // taken at the bench stand for it.
  const readings = await recordManualReadings({
    experiment: experiment.id,
    observation: day14.id,
    readings: [
      { unit: units.get("A-1")!, tally: { germinated: 17 } },
      { unit: units.get("A-2")!, tally: { germinated: 12 } },
    ],
  });
  expect(readings.map((item) => [item.unit, item.tally]).sort()).toEqual(
    [
      [units.get("A-1")!, { germinated: 17 }],
      [units.get("A-2")!, { germinated: 12 }],
    ].sort(),
  );

  const grid = (await experimentGridDetail(experiment.id))!;
  expect(
    grid.observations.map((item) => [item.observedOn, item.hasRecords]),
  ).toEqual([
    [INOCULATED, true],
    ["2026-08-15", true],
  ]);
  const cells = observationCells(grid.images, grid.manualReadings);
  expect(unitReading(cells, units.get("A-1")!, day14)).toEqual({
    count: 17,
    source: "manual",
  });
  expect(unitReading(cells, units.get("A-2")!, day14)).toEqual({
    count: 12,
    source: "manual",
  });
  expect(unitReading(cells, units.get("A-1")!, day0)).toEqual({
    count: 3,
    source: "detection",
  });

  // A person who counted the photographed dish is believed over the detector.
  await recordManualReadings({
    experiment: experiment.id,
    observation: day0.id,
    readings: [
      {
        unit: units.get("A-1")!,
        tally: { ungerminated: 4, germinated: 0 },
      },
    ],
  });
  const recounted = (await experimentGridDetail(experiment.id))!;
  expect(
    unitReading(
      observationCells(recounted.images, recounted.manualReadings),
      units.get("A-1")!,
      day0,
    ),
  ).toEqual({ count: 4, source: "manual" });
  expect(recounted.images).toHaveLength(1);

  // The unit's page carries the count on a day it has no photograph of.
  const series = (await unitDetail(
    { experiment: experiment.id, unit: units.get("A-2")! },
    day14.id,
  ))!;
  expect(
    series.observations.map((item) => [item.image, item.manual?.tally]),
  ).toEqual([
    [null, undefined],
    [null, { germinated: 12 }],
  ]);
  expect(series.shown).toBeNull();

  // A count is replaced by entering it again, and withdrawn by entering nothing.
  await recordManualReadings({
    experiment: experiment.id,
    observation: day14.id,
    readings: [
      { unit: units.get("A-1")!, tally: { germinated: 18 } },
      { unit: units.get("A-2")!, tally: null },
    ],
  });
  const corrected = (await experimentGridDetail(experiment.id))!;
  expect(
    corrected.manualReadings
      .filter((item) => item.observation === day14.id)
      .map((item) => [item.unit, item.tally]),
  ).toEqual([[units.get("A-1")!, { germinated: 18 }]]);
});

test("a count answers the day's question in the model's classes", async () => {
  const version = await trainedVersion("exp-manual-classes");
  const experiment = await createExperiment({
    name: "Manual classes",
    inoculatedOn: INOCULATED,
  });
  const units = await unitsOf(experiment.id);
  const day0 = await createObservation({
    experiment: experiment.id,
    observedOn: INOCULATED,
    note: "",
    ...reading(version),
  });
  const unit = units.get("A-1")!;
  await expect(
    recordManualReadings({
      experiment: experiment.id,
      observation: day0.id,
      readings: [{ unit, tally: { ungerminated: 4, shoots: 1 } }],
    }),
  ).rejects.toThrow(ManualReadingConflictError);
  // Every class the day counts must be given: a class left out is not zero.
  await expect(
    recordManualReadings({
      experiment: experiment.id,
      observation: day0.id,
      readings: [{ unit, tally: { germinated: 4 } }],
    }),
  ).rejects.toThrow(ManualReadingConflictError);
  await expect(
    recordManualReadings({
      experiment: experiment.id,
      observation: day0.id,
      readings: [
        { unit: randomUUID(), tally: { ungerminated: 4, germinated: 0 } },
      ],
    }),
  ).rejects.toThrow(UnitNotFoundError);
  await expect(
    recordManualReadings({
      experiment: experiment.id,
      observation: randomUUID(),
      readings: [{ unit, tally: { ungerminated: 4, germinated: 0 } }],
    }),
  ).rejects.toThrow(ObservationNotFoundError);
  expect((await experimentGridDetail(experiment.id))!.manualReadings).toEqual(
    [],
  );
});

test("a count is a record: it keeps its observation and unit, and holds a unit on the bench", async () => {
  const version = await trainedVersion("exp-manual-records");
  const experiment = await createExperiment({
    name: "Manual records",
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
  const unit = units.get("A-1")!;
  await recordManualReadings({
    experiment: experiment.id,
    observation: day14.id,
    readings: [{ unit, tally: { ungerminated: 2, germinated: 9 } }],
  });

  await expect(
    deleteObservation({ experiment: experiment.id, observation: day14.id }),
  ).rejects.toThrow(ObservationConflictError);
  await expect(deleteUnit({ experiment: experiment.id, unit })).rejects.toThrow(
    UnitConflictError,
  );
  // A dish counted on day 14 was still on the bench then.
  await expect(
    recordCultureEvents({
      experiment: experiment.id,
      units: [unit],
      type: "discarded",
      observation: day7.id,
    }),
  ).rejects.toThrow(UnitConflictError);

  // A dish that left the bench cannot be counted afterwards.
  await recordCultureEvents({
    experiment: experiment.id,
    units: [units.get("A-2")!],
    type: "discarded",
    observation: day7.id,
  });
  await expect(
    recordManualReadings({
      experiment: experiment.id,
      observation: day14.id,
      readings: [
        {
          unit: units.get("A-2")!,
          tally: { ungerminated: 0, germinated: 1 },
        },
      ],
    }),
  ).rejects.toThrow(ManualReadingConflictError);

  // Withdrawing the count frees the observation and the unit again.
  await recordManualReadings({
    experiment: experiment.id,
    observation: day14.id,
    readings: [{ unit, tally: null }],
  });
  await deleteObservation({
    experiment: experiment.id,
    observation: day14.id,
  });
  await deleteUnit({ experiment: experiment.id, unit });
});

test("a new model cannot reinterpret existing manual counts", async () => {
  const version = await trainedVersion("manual-model-identity");
  const experiment = await createExperiment({
    name: "Manual model identity",
    inoculatedOn: INOCULATED,
  });
  const unit = (await unitsOf(experiment.id)).get("A-1")!;
  const observation = await createObservation({
    experiment: experiment.id,
    observedOn: INOCULATED,
    note: "",
    ...reading(version),
  });
  const other = await createModel({
    id: "other-manual-model",
    name: "Other meaning",
    classes: ["ungerminated", "germinated"],
  });
  await recordManualReadings({
    experiment: experiment.id,
    observation: observation.id,
    readings: [{ unit, tally: { ungerminated: 4, germinated: 1 } }],
  });
  const update = {
    experiment: experiment.id,
    observation: observation.id,
    observedOn: INOCULATED,
    note: "",
    modelId: other.id,
    countedClasses: other.classes,
  };
  await expect(updateObservation(update)).rejects.toThrow(
    ObservationModelCountsConflictError,
  );
  const grid = (await experimentGridDetail(experiment.id))!;
  expect(grid.observations[0]!.modelId).toBe(version.modelId);
  expect(grid.manualReadings[0]!.tally).toEqual({
    ungerminated: 4,
    germinated: 1,
  });
  const recounted = await updateObservation({
    ...update,
    modelId: version.modelId,
    countedClasses: ["germinated"],
  });
  expect(recounted.countedClasses).toEqual(["germinated"]);
  await recordManualReadings({
    experiment: experiment.id,
    observation: observation.id,
    readings: [{ unit, tally: null }],
  });
  expect((await updateObservation(update)).modelId).toBe(other.id);
});
