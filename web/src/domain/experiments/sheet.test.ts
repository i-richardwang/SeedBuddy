import { describe, expect, test } from "bun:test";

import type { CultureEvent } from "./culture-events";
import type { ExperimentGridDetail, ObservationImageCell } from "./read-model";
import type {
  Experiment,
  ExperimentObservation,
  ManualReading,
} from "./schema";
import { experimentSheet, unitRow } from "./sheet";

const experiment: Experiment = {
  id: "experiment",
  name: "Sheet",
  plantMaterial: "",
  explantType: "",
  baseMedium: "",
  notes: "",
  inoculatedOn: "2026-08-01",
  countsUnclear: false,
  createdAt: "2026-08-01T00:00:00.000Z",
};

function observation(
  ordinal: number,
  counted: string[],
): ExperimentObservation {
  return {
    id: `day-${ordinal}`,
    ordinal,
    observedOn: `2026-09-0${ordinal}`,
    note: "",
    modelId: "seed-detector",
    countedClasses: counted,
    hasRecords: true,
  };
}

const day1 = observation(1, ["ungerminated", "germinated"]);
const day2 = observation(2, ["germinated"]);

function photograph(
  unit: string,
  day: ExperimentObservation,
  overrides: Partial<ObservationImageCell> = {},
): ObservationImageCell {
  return {
    id: `${unit}-${day.id}`,
    unit,
    observation: day.id,
    digest: "a".repeat(64),
    filename: `${unit}.jpg`,
    state: "analyzed",
    detectionTally: { ungerminated: 6, germinated: 4 },
    proposalTally: null,
    annotationTally: null,
    error: null,
    unclear: false,
    ...overrides,
  };
}

function counted(
  unit: string,
  day: ExperimentObservation,
  tally: ManualReading["tally"],
): ManualReading {
  return {
    unit,
    observation: day.id,
    tally,
    recordedAt: "2026-09-08T00:00:00.000Z",
  };
}

function event(type: CultureEvent["type"], on: ExperimentObservation) {
  return {
    id: `${type}-${on.id}`,
    type,
    observation: on.id,
    recordedAt: "2026-09-01T00:00:00.000Z",
  };
}

function grid(
  overrides: Partial<ExperimentGridDetail> = {},
): ExperimentGridDetail {
  return {
    experiment,
    treatments: [
      { id: "control", name: "Control", factor: null, note: "", position: 1 },
      { id: "treated", name: "Treated", factor: null, note: "", position: 2 },
    ],
    units: [
      { id: "c1", code: "Control-1", treatment: "control", events: [] },
      { id: "t1", code: "Treated-1", treatment: "treated", events: [] },
    ],
    observations: [day1, day2],
    images: [],
    manualReadings: [],
    ...overrides,
  };
}

function cell(
  sheet: ReturnType<typeof experimentSheet>,
  unit: string,
  day: ExperimentObservation,
) {
  const found = sheet.cells.find(
    (item) => item.unit === unit && item.observation === day.id,
  );
  if (!found) throw new Error(`No cell for ${unit} on ${day.id}`);
  return found;
}

describe("the sheet an agent reads", () => {
  test("has a cell for every unit on every observation, in the grid's order", () => {
    const sheet = experimentSheet(grid());
    expect(
      sheet.cells.map(({ unit, observation }) => `${unit}/${observation}`),
    ).toEqual(["c1/day-1", "c1/day-2", "t1/day-1", "t1/day-2"]);
    expect(cell(sheet, "c1", day1)).toEqual({
      unit: "c1",
      observation: day1.id,
      reading: null,
      exclusion: null,
      image: null,
      manual: null,
    });
  });

  test("resolves a cell to the reading the analysis uses, over the evidence it came from", () => {
    const sheet = experimentSheet(
      grid({
        images: [
          photograph("c1", day1),
          photograph("c1", day2, { annotationTally: { germinated: 5 } }),
        ],
      }),
    );
    const first = cell(sheet, "c1", day1);
    expect(first.reading).toEqual({ count: 10, source: "detection" });
    expect(first.image).toMatchObject({
      id: "c1-day-1",
      digest: "a".repeat(64),
      state: "analyzed",
      detectionTally: { ungerminated: 6, germinated: 4 },
    });
    expect(first.image).not.toHaveProperty("unit");
    expect(cell(sheet, "c1", day2).reading).toEqual({
      count: 5,
      source: "review",
    });
  });

  test("a count entered by hand outranks the photograph and stays beside it", () => {
    const sheet = experimentSheet(
      grid({
        images: [photograph("t1", day2)],
        manualReadings: [counted("t1", day2, { germinated: 7 })],
      }),
    );
    expect(cell(sheet, "t1", day2)).toMatchObject({
      reading: { count: 7, source: "manual" },
      image: { detectionTally: { ungerminated: 6, germinated: 4 } },
      manual: { tally: { germinated: 7 } },
    });
    expect(cell(sheet, "t1", day2).manual).not.toHaveProperty("unit");
  });

  test("a count that leaves a counted class unanswered reads nothing by itself", () => {
    const sheet = experimentSheet(
      grid({ manualReadings: [counted("t1", day1, { germinated: 7 })] }),
    );
    expect(cell(sheet, "t1", day1)).toMatchObject({
      reading: null,
      manual: { tally: { germinated: 7 } },
    });
  });

  test("says why a day is out of the analysis, with or without a reading", () => {
    const contaminated = event("contaminated", day1);
    const sheet = experimentSheet(
      grid({
        units: [
          { id: "c1", code: "Control-1", treatment: "control", events: [] },
          {
            id: "t1",
            code: "Treated-1",
            treatment: "treated",
            events: [contaminated],
          },
        ],
        images: [
          photograph("t1", day1),
          photograph("c1", day1, { unclear: true }),
        ],
      }),
    );
    expect(cell(sheet, "t1", day1)).toMatchObject({
      reading: { count: 10, source: "detection" },
      exclusion: { reason: "event", event: contaminated },
    });
    expect(cell(sheet, "t1", day2)).toMatchObject({
      reading: null,
      exclusion: { reason: "event", event: contaminated },
    });
    // An unclear photograph takes its unit out on every day, where the experiment does not count it.
    expect(cell(sheet, "c1", day1).exclusion).toEqual({ reason: "unclear" });
    expect(cell(sheet, "c1", day2).exclusion).toEqual({ reason: "unclear" });
  });

  test("where unclear photographs count, the number is used as it stands", () => {
    const sheet = experimentSheet(
      grid({
        experiment: { ...experiment, countsUnclear: true },
        images: [photograph("c1", day1, { unclear: true })],
      }),
    );
    expect(cell(sheet, "c1", day1)).toMatchObject({
      reading: { count: 10, source: "detection" },
      exclusion: null,
    });
  });
});

describe("a unit's row of the sheet", () => {
  test("carries the unit, its treatment, and its cells alone", () => {
    const source = grid({
      images: [photograph("t1", day1), photograph("c1", day1)],
    });
    const row = unitRow(source, "t1");
    expect(row).toMatchObject({
      experiment,
      treatment: { id: "treated" },
      unit: { id: "t1" },
      observations: [day1, day2],
    });
    expect(
      row!.cells.map(({ unit, observation }) => `${unit}/${observation}`),
    ).toEqual(["t1/day-1", "t1/day-2"]);
    expect(row!.cells[0]!.reading).toEqual({ count: 10, source: "detection" });
  });

  test("is nothing for a unit the experiment does not have", () => {
    expect(unitRow(grid(), "stranger")).toBeNull();
  });
});
