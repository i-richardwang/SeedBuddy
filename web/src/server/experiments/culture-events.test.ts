import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import {
  ObservationImageAssignmentConflictError,
  UnitConflictError,
  UnitNotFoundError,
} from "../../domain/experiments/errors";
import { database } from "../infra/db/client";
import { experimentCultureEvents } from "../infra/db/schema";
import { experimentGridDetail } from "../queries/experiment-details";
import {
  createExperiment,
  INOCULATED,
  reading,
  trainedVersion,
  unitsOf,
} from "../testing/experiments";
import { storeTexts } from "../testing/images";
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
    event: recorded[0]!.value[0]!.id,
  });
  await expect(
    recordCultureEvents({
      experiment: experiment.id,
      units: [units.get("A-1")!],
      type: "missing",
      observation: day7.id,
    }),
  ).resolves.toMatchObject([{ type: "missing" }]);
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

  const [event] = await recordCultureEvents({
    experiment: experiment.id,
    units: [units.get("A-1")!],
    type: "contaminated",
    observation: day7.id,
  });
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
  const [terminalEvent] = await recordCultureEvents({
    experiment: experiment.id,
    units: [units.get("A-1")!],
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
  ).rejects.toThrow(ObservationImageAssignmentConflictError);
  await deleteCultureEvent({
    experiment: experiment.id,
    event: terminalEvent!.id,
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

  const events = await recordCultureEvents({
    experiment: experiment.id,
    units: [units.get("A-1")!, units.get("A-2")!],
    type: "contaminated",
    observation: day7.id,
  });
  expect(events.map((event) => event!.type)).toEqual([
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
    (await experimentGridDetail(experiment.id))?.units.filter((unit) =>
      unit.events.some((event) => event!.type === "contaminated"),
    ),
  ).toHaveLength(2);
});
