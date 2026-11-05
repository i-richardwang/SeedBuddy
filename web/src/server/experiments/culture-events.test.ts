import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import {
  ObservationImageConflictError,
  UnitConflictError,
  UnitNotFoundError,
  UnitSelectionConflictError,
} from "../../domain/experiments/errors";
import { database } from "../infra/db/client";
import { experimentCultureEvents } from "../infra/db/schema";
import { experimentRecordsDetail } from "../queries/experiment-records-detail";
import {
  createExperiment,
  INOCULATED,
  reading,
  unitsOf,
} from "../testing/experiments";
import { storeTexts } from "../testing/images";
import { trainedVersion } from "../testing/models";
import { deleteCultureEvent, recordCultureEvents } from "./culture-events";
import { assignObservationImages } from "./observation-images";
import { createObservation } from "./observations";

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
    recordCultureEvents({
      experiment: experiment.id,
      units: [units.get("A-1")!],
      type: "discarded",
      observation: day7.id,
    }),
    recordCultureEvents({
      experiment: experiment.id,
      units: [units.get("A-1")!],
      type: "harvested",
      observation: day7.id,
    }),
  ]);
  const recorded = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  expect(recorded).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]!.reason).toBeInstanceOf(UnitConflictError);

  await deleteCultureEvent({
    experiment: experiment.id,
    event: recorded[0]!.value.recorded[0]!.event.id,
  });
  await expect(
    recordCultureEvents({
      experiment: experiment.id,
      units: [units.get("A-1")!],
      type: "missing",
      observation: day7.id,
    }),
  ).resolves.toMatchObject({
    recorded: [{ unit: units.get("A-1")!, event: { type: "missing" } }],
    passedOver: [],
  });
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

  const [contamination] = (
    await recordCultureEvents({
      experiment: experiment.id,
      units: [units.get("A-1")!],
      type: "contaminated",
      observation: day7.id,
    })
  ).recorded;
  const event = contamination!.event;
  expect([event!.type, event!.observation]).toEqual(["contaminated", day7.id]);
  await expect(
    recordCultureEvents({
      experiment: experiment.id,
      units: [units.get("A-1")!],
      type: "contaminated",
      observation: day7.id,
    }),
  ).rejects.toThrow(UnitConflictError);

  await deleteCultureEvent({ experiment: experiment.id, event: event!.id });

  const day14 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-15",
    note: "",
    ...reading(version),
  });
  const [terminal] = (
    await recordCultureEvents({
      experiment: experiment.id,
      units: [units.get("A-1")!],
      type: "discarded",
      observation: day7.id,
    })
  ).recorded;
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
  ).rejects.toThrow(ObservationImageConflictError);
  await deleteCultureEvent({
    experiment: experiment.id,
    event: terminal!.event.id,
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
    recordCultureEvents({
      experiment: experiment.id,
      units: [units.get("A-1")!],
      type: "harvested",
      observation: day7.id,
    }),
  ).rejects.toThrow("has records after this observation");

  await recordCultureEvents({
    experiment: experiment.id,
    units: [units.get("A-2")!],
    type: "contaminated",
    observation: day14.id,
  });
  await expect(
    recordCultureEvents({
      experiment: experiment.id,
      units: [units.get("A-2")!],
      type: "discarded",
      observation: day7.id,
    }),
  ).rejects.toThrow("has records after this observation");

  await expect(
    recordCultureEvents({
      experiment: experiment.id,
      units: [randomUUID()],
      type: "missing",
      observation: day7.id,
    }),
  ).rejects.toThrow(UnitNotFoundError);

  const rows = await (await database()).select().from(experimentCultureEvents);
  expect(rows.some((row) => row.id === event!.id)).toBeFalse();
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

  const { recorded } = await recordCultureEvents({
    experiment: experiment.id,
    units: [units.get("A-1")!, units.get("A-2")!],
    type: "contaminated",
    observation: day7.id,
  });
  expect(recorded.map(({ event }) => event.type)).toEqual([
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
  ).rejects.toThrow(UnitConflictError);
  expect(
    (await experimentRecordsDetail(experiment.id))?.units.filter((unit) =>
      unit.events.some((event) => event!.type === "contaminated"),
    ),
  ).toHaveLength(2);
});

test("an event for a treatment's units passes over those that cannot take it", async () => {
  const version = await trainedVersion("exp-selected-events");
  const experiment = await createExperiment({
    name: "Selected events",
    inoculatedOn: INOCULATED,
    treatments: [
      { name: "A", replicates: 3 },
      { name: "B", replicates: 1 },
    ],
  });
  const units = await unitsOf(experiment.id);
  const [a] = (await experimentRecordsDetail(experiment.id))!.treatments;
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
  await recordCultureEvents({
    experiment: experiment.id,
    units: [units.get("A-1")!],
    type: "discarded",
    observation: day7.id,
  });
  await recordCultureEvents({
    experiment: experiment.id,
    units: [units.get("A-2")!],
    type: "contaminated",
    observation: day14.id,
  });

  const result = await recordCultureEvents({
    experiment: experiment.id,
    units: { treatment: a!.id, expected: 3 },
    type: "contaminated",
    observation: day14.id,
  });
  expect(result.recorded.map(({ unit }) => unit)).toEqual([units.get("A-3")!]);
  expect(result.passedOver).toEqual([
    { unit: units.get("A-1")!, code: "A-1", reason: "left_before" },
    { unit: units.get("A-2")!, code: "A-2", reason: "recorded" },
  ]);

  // A choice of every unit made over three is refused now the experiment has four.
  await expect(
    recordCultureEvents({
      experiment: experiment.id,
      units: { treatment: null, expected: 3 },
      type: "nonviable",
      observation: day14.id,
    }),
  ).rejects.toBeInstanceOf(UnitSelectionConflictError);
  // A-2 and A-3 have events after the first day, so cannot leave on it.
  const all = await recordCultureEvents({
    experiment: experiment.id,
    units: { treatment: null, expected: 4 },
    type: "harvested",
    observation: day7.id,
  });
  expect(all.recorded.map(({ unit }) => unit)).toEqual([units.get("B-1")!]);
  expect(all.passedOver).toEqual([
    { unit: units.get("A-1")!, code: "A-1", reason: "already_left" },
    { unit: units.get("A-2")!, code: "A-2", reason: "later_records" },
    { unit: units.get("A-3")!, code: "A-3", reason: "later_records" },
  ]);
});
