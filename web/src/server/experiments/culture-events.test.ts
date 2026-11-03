import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import {
  ObservationImageRejectedError,
  UnitNotFoundError,
  UnitRejectedError,
} from "../../domain/experiments/errors";
import { database } from "../infra/db/client";
import { experimentCultureEvents } from "../infra/db/schema";
import { storeTexts } from "../testing/fixtures";
import {
  deleteCultureEvent,
  recordCultureEvent,
  recordCultureEvents,
} from "./culture-events";
import { recordManualReadings } from "./manual-readings";
import { assignObservationImages } from "./observation-images";
import { createObservation, updateObservation } from "./observations";
import { readExperimentGrid } from "./queries";
import {
  createExperiment,
  INOCULATED,
  reading,
  trainedVersion,
  unitsOf,
} from "./testing";

test("at most one terminal event", async () => {
  const version = await trainedVersion("exp-terminal-events");
  const experiment = await createExperiment({
    name: "Terminal events",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "A", replicates: 1 }],
  });
  const units = await unitsOf(experiment.id);
  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });

  const results = await Promise.allSettled([
    recordCultureEvent({
      experiment: experiment.id,
      unit: units.get("A-1")!,
      type: "discarded",
      observation: day7.id,
    }),
    recordCultureEvent({
      experiment: experiment.id,
      unit: units.get("A-1")!,
      type: "harvested",
      observation: day7.id,
    }),
  ]);
  const recorded = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  expect(recorded).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]!.reason).toBeInstanceOf(UnitRejectedError);

  await deleteCultureEvent({
    experiment: experiment.id,
    event: recorded[0]!.value.id,
  });
  await expect(
    recordCultureEvent({
      experiment: experiment.id,
      unit: units.get("A-1")!,
      type: "missing",
      observation: day7.id,
    }),
  ).resolves.toMatchObject({ type: "missing" });
});

test("culture events take effect until they are removed", async () => {
  const version = await trainedVersion("exp-missing");
  const experiment = await createExperiment({
    name: "Contamination",
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

  const event = await recordCultureEvent({
    experiment: experiment.id,
    unit: units.get("A-1")!,
    type: "contaminated",
    observation: day7.id,
  });
  expect([event.type, event.observation]).toEqual(["contaminated", day7.id]);
  await expect(
    recordCultureEvent({
      experiment: experiment.id,
      unit: units.get("A-1")!,
      type: "contaminated",
      observation: day7.id,
    }),
  ).rejects.toThrow(UnitRejectedError);

  await deleteCultureEvent({ experiment: experiment.id, event: event.id });

  const day14 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-15",
    note: "",
    ...reading(version),
  });
  const terminalEvent = await recordCultureEvent({
    experiment: experiment.id,
    unit: units.get("A-1")!,
    type: "discarded",
    observation: day7.id,
  });
  const [futurePhoto] = await storeTexts(["terminal-a1"]);
  await expect(
    assignObservationImages({
      experiment: experiment.id,
      observation: day14.id,
      images: [
        {
          unit: units.get("A-1")!,
          digest: futurePhoto!,
          filename: "A1.jpg",
        },
      ],
    }),
  ).rejects.toThrow(ObservationImageRejectedError);
  await deleteCultureEvent({
    experiment: experiment.id,
    event: terminalEvent.id,
  });
  await assignObservationImages({
    experiment: experiment.id,
    observation: day14.id,
    images: [
      {
        unit: units.get("A-1")!,
        digest: futurePhoto!,
        filename: "A1.jpg",
      },
    ],
  });

  await expect(
    recordCultureEvent({
      experiment: experiment.id,
      unit: units.get("A-1")!,
      type: "harvested",
      observation: day7.id,
    }),
  ).rejects.toThrow("has records after this observation");

  await recordCultureEvent({
    experiment: experiment.id,
    unit: units.get("A-2")!,
    type: "contaminated",
    observation: day14.id,
  });
  await expect(
    recordCultureEvent({
      experiment: experiment.id,
      unit: units.get("A-2")!,
      type: "discarded",
      observation: day7.id,
    }),
  ).rejects.toThrow("has records after this observation");

  await expect(
    recordCultureEvent({
      experiment: experiment.id,
      unit: randomUUID(),
      type: "missing",
      observation: day7.id,
    }),
  ).rejects.toThrow(UnitNotFoundError);

  const rows = await (await database()).select().from(experimentCultureEvents);
  expect(rows.some((row) => row.id === event.id)).toBeFalse();
});

test("the same culture event can be recorded on several units", async () => {
  const version = await trainedVersion("exp-bulk-events");
  const experiment = await createExperiment({
    name: "Bulk events",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "A", replicates: 3 }],
  });
  const units = await unitsOf(experiment.id);
  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });

  const events = await recordCultureEvents({
    experiment: experiment.id,
    units: [units.get("A-1")!, units.get("A-2")!],
    type: "contaminated",
    observation: day7.id,
  });
  expect(events.map((event) => event.type)).toEqual([
    "contaminated",
    "contaminated",
  ]);

  await expect(
    recordCultureEvents({
      experiment: experiment.id,
      units: [units.get("A-2")!, units.get("A-3")!],
      type: "contaminated",
      observation: day7.id,
    }),
  ).rejects.toThrow(UnitRejectedError);
  expect(
    (await readExperimentGrid(experiment.id))?.units.filter((unit) =>
      unit.events.some((event) => event.type === "contaminated"),
    ),
  ).toHaveLength(2);
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
  await recordCultureEvent({
    experiment: experiment.id,
    unit,
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
    ).rejects.toThrow(UnitRejectedError);
    const grid = (await readExperimentGrid(experiment.id))!;
    expect(
      grid.observations.find((item) => item.id === observation.id)!.observedOn,
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
