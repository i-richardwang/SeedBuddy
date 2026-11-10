import { describe, expect, test } from "bun:test";

import type { ExperimentRecords } from "./read-model";
import type { Experiment } from "./schema";
import { sheetRows, unitRow } from "./sheet";
import {
  counted,
  event,
  observation,
  photograph,
  records,
  rowCell,
} from "./testing";

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

const day1 = observation(1, ["ungerminated", "germinated"]);
const day2 = observation(2, ["germinated"]);

function scenario(
  overrides: Partial<ExperimentRecords> = {},
): ExperimentRecords {
  return records({
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
  });
}

describe("the sheet an agent reads", () => {
  test("has a cell for every unit on every observation, in the order the records hold them", () => {
    const sheet = sheetRows(scenario());
    expect(
      sheet.flatMap(({ unit, cells }) =>
        cells.map(({ observation }) => `${unit.id}/${observation}`),
      ),
    ).toEqual(["c1/day-1", "c1/day-2", "t1/day-1", "t1/day-2"]);
    expect(rowCell(sheet, "c1", day1)).toEqual({
      observation: day1.id,
      reading: null,
      exclusion: null,
      image: null,
      manual: null,
    });
  });

  test("resolves a cell to the reading the analysis uses, over the evidence it came from", () => {
    const sheet = sheetRows(
      scenario({
        images: [
          photograph("c1", day1, {
            detectionTally: { ungerminated: 6, germinated: 4 },
          }),
          photograph("c1", day2, {
            detectionTally: { ungerminated: 6, germinated: 4 },
            ...{ annotationTally: { germinated: 5 } },
          }),
        ],
      }),
    );
    const first = rowCell(sheet, "c1", day1);
    expect(first.reading).toEqual({
      count: 10,
      source: "detection",
      unfound: [],
    });
    expect(first.image).toMatchObject({
      id: "c1-day-1",
      digest: "a".repeat(64),
      state: "analyzed",
      detectionTally: { ungerminated: 6, germinated: 4 },
    });
    expect(first.image).not.toHaveProperty("unit");
    expect(rowCell(sheet, "c1", day2).reading).toEqual({
      count: 5,
      source: "review",
      unfound: [],
    });
  });

  test("a count entered by hand outranks the photograph and stays beside it", () => {
    const sheet = sheetRows(
      scenario({
        images: [
          photograph("t1", day2, {
            detectionTally: { ungerminated: 6, germinated: 4 },
          }),
        ],
        manualReadings: [counted("t1", day2, { germinated: 7 })],
      }),
    );
    expect(rowCell(sheet, "t1", day2)).toMatchObject({
      reading: { count: 7, source: "manual" },
      image: { detectionTally: { ungerminated: 6, germinated: 4 } },
      manual: { tally: { germinated: 7 } },
    });
    expect(rowCell(sheet, "t1", day2).manual).not.toHaveProperty("unit");
  });

  test("a count that leaves a counted class unanswered reads nothing by itself", () => {
    const sheet = sheetRows(
      scenario({ manualReadings: [counted("t1", day1, { germinated: 7 })] }),
    );
    expect(rowCell(sheet, "t1", day1)).toMatchObject({
      reading: null,
      manual: { tally: { germinated: 7 } },
    });
  });

  test("says why a day is out of the analysis, with or without a reading", () => {
    const contaminated = event("contaminated", day1);
    const sheet = sheetRows(
      scenario({
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
          photograph("t1", day1, {
            detectionTally: { ungerminated: 6, germinated: 4 },
          }),
          photograph("c1", day1, {
            detectionTally: { ungerminated: 6, germinated: 4 },
            ...{ unclear: true },
          }),
        ],
      }),
    );
    expect(rowCell(sheet, "t1", day1)).toMatchObject({
      reading: { count: 10, source: "detection" },
      exclusion: { reason: "event", event: contaminated },
    });
    expect(rowCell(sheet, "t1", day2)).toMatchObject({
      reading: null,
      exclusion: { reason: "event", event: contaminated },
    });
    // An unclear photograph takes its unit out on every day, where the experiment does not count it.
    expect(rowCell(sheet, "c1", day1).exclusion).toEqual({ reason: "unclear" });
    expect(rowCell(sheet, "c1", day2).exclusion).toEqual({ reason: "unclear" });
  });

  test("where unclear photographs count, the number is used as it stands", () => {
    const sheet = sheetRows(
      scenario({
        experiment: { ...experiment, countsUnclear: true },
        images: [
          photograph("c1", day1, {
            detectionTally: { ungerminated: 6, germinated: 4 },
            ...{ unclear: true },
          }),
        ],
      }),
    );
    expect(rowCell(sheet, "c1", day1)).toMatchObject({
      reading: { count: 10, source: "detection" },
      exclusion: null,
    });
  });
});

describe("a unit's row of the sheet", () => {
  test("carries the unit, its treatment, and its cells alone", () => {
    const source = scenario({
      images: [
        photograph("t1", day1, {
          detectionTally: { ungerminated: 6, germinated: 4 },
        }),
        photograph("c1", day1, {
          detectionTally: { ungerminated: 6, germinated: 4 },
        }),
      ],
    });
    const row = unitRow(source, "t1");
    expect(row).toMatchObject({
      experiment,
      treatment: { id: "treated" },
      unit: { id: "t1" },
      observations: [day1, day2],
    });
    expect(row!.cells.map(({ observation }) => observation)).toEqual([
      "day-1",
      "day-2",
    ]);
    expect(row!.cells[0]!.reading).toEqual({
      count: 10,
      source: "detection",
      unfound: [],
    });
  });

  test("is nothing for a unit the experiment does not have", () => {
    expect(unitRow(scenario(), "stranger")).toBeNull();
  });
});
