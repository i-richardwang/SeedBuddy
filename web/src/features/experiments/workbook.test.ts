import { describe, expect, test } from "bun:test";

import type {
  ObservationImageCell,
  Unit,
} from "../../domain/experiments/read-model";
import type {
  Experiment,
  ExperimentObservation,
  Treatment,
} from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import { DEFAULT_MODEL_ANNOTATION } from "../../domain/models/schema";
import type { WorkbookCell } from "../../lib/spreadsheet/workbook";
import {
  type ExperimentWorkbookSource,
  experimentWorkbook,
  experimentWorkbookFilename,
  recordsSheet,
  summarySheet,
} from "./workbook";

const HEADING_ROWS = 2;

const SEEDS: Model = {
  schemaVersion: 1,
  id: "seed-detector",
  name: "Seed germination",
  task: "object_detection",
  classes: ["ungerminated", "germinated"],
  countedClasses: ["ungerminated", "germinated"],
  area: "image",
  annotation: DEFAULT_MODEL_ANNOTATION,
};

const ROOTS: Model = {
  schemaVersion: 1,
  id: "rooting",
  name: "Rooting",
  task: "object_detection",
  classes: ["rooted"],
  countedClasses: ["rooted"],
  area: "image",
  annotation: DEFAULT_MODEL_ANNOTATION,
};

const EXPERIMENT: Experiment = {
  id: "experiment",
  name: "Germination trial",
  plantMaterial: "Chrysanthemum 'Jinba'",
  explantType: "",
  baseMedium: "MS",
  notes: "",
  inoculatedOn: "2026-09-01",
  countsUnclear: false,
  createdAt: "2026-09-01T00:00:00.000Z",
};

const SOWN: ExperimentObservation = {
  id: "sown",
  ordinal: 1,
  observedOn: "2026-09-01",
  note: "",
  modelId: SEEDS.id,
  countedClasses: SEEDS.classes,
  hasRecords: true,
};

const ROOTED: ExperimentObservation = {
  id: "rooted",
  ordinal: 2,
  observedOn: "2026-09-15",
  note: "",
  modelId: ROOTS.id,
  countedClasses: ROOTS.classes,
  hasRecords: true,
};

const GERMINATED: ExperimentObservation = {
  id: "germinated",
  ordinal: 2,
  observedOn: "2026-09-08",
  note: "",
  modelId: SEEDS.id,
  countedClasses: ["germinated"],
  hasRecords: true,
};

const TREATMENT: Treatment = {
  id: "control",
  name: "CK",
  factor: { name: "BA", level: "0", unit: "mg/L" },
  note: "",
  position: 1,
};

const CONTAMINATED: Unit["events"] = [
  {
    id: "event",
    type: "contaminated",
    observation: ROOTED.id,
    recordedAt: "2026-09-15T00:00:00.000Z",
  },
];

function unit(code: string, events: Unit["events"] = []): Unit {
  return { id: code, code, treatment: TREATMENT.id, events };
}

function image(
  unitId: string,
  observation: string,
  tally: Record<string, number>,
  unclear = false,
): ObservationImageCell {
  return {
    id: `${unitId}-${observation}`,
    unit: unitId,
    observation,
    digest: "a".repeat(64),
    filename: `${unitId}.JPG`,
    state: "analyzed",
    detectionTally: tally,
    detectionUnfound: [],
    proposalTally: null,
    annotationTally: null,
    error: null,
    unclear,
  };
}

function source(
  overrides: Partial<ExperimentWorkbookSource> = {},
): ExperimentWorkbookSource {
  return {
    experiment: EXPERIMENT,
    treatments: [TREATMENT],
    units: [unit("A1"), unit("A2")],
    observations: [SOWN, ROOTED],
    images: [
      image("A1", SOWN.id, { ungerminated: 20 }),
      image("A2", SOWN.id, { ungerminated: 20 }),
      image("A1", ROOTED.id, { rooted: 15 }),
      image("A2", ROOTED.id, { rooted: 10 }),
    ],
    manualReadings: [],
    models: [SEEDS, ROOTS],
    ...overrides,
  };
}

/** The records sheet of the trial's workbook. */
function trial(overrides: Partial<ExperimentWorkbookSource> = {}) {
  return recordsSheet(source(overrides), "2026-09-20");
}

/** The summary sheet of the trial's workbook. */
function summary(overrides: Partial<ExperimentWorkbookSource> = {}) {
  return summarySheet(source(overrides), "2026-09-20");
}

function describes(workbook: ReturnType<typeof trial>): WorkbookCell[][] {
  return workbook.rows.slice(0, workbook.stickyRows - HEADING_ROWS);
}

function heading(workbook: ReturnType<typeof trial>): WorkbookCell[][] {
  return workbook.rows.slice(
    workbook.stickyRows - HEADING_ROWS,
    workbook.stickyRows,
  );
}

function readings(workbook: ReturnType<typeof trial>): WorkbookCell[][] {
  return workbook.rows.slice(workbook.stickyRows);
}

describe("the experiment workbook", () => {
  test("says which experiment it is and when it was taken", () => {
    expect(describes(trial())).toEqual([
      [{ kind: "text", text: "Germination trial", strong: true }],
      [
        { kind: "text", text: "Plant material", strong: true },
        { kind: "text", text: "Chrysanthemum 'Jinba'" },
      ],
      [
        { kind: "text", text: "Base medium", strong: true },
        { kind: "text", text: "MS" },
      ],
      [
        { kind: "text", text: "Inoculated", strong: true },
        { kind: "date", date: new Date(Date.UTC(2026, 8, 1)) },
      ],
      [
        { kind: "text", text: "Exported on", strong: true },
        { kind: "date", date: new Date(Date.UTC(2026, 8, 20)) },
      ],
      [],
    ]);
  });

  test("heads every day with its date, and names its model underneath", () => {
    const [dates, models] = heading(trial());
    expect(dates?.slice(3)).toEqual([
      { kind: "date", date: new Date(Date.UTC(2026, 8, 1)), strong: true },
      { kind: "date", date: new Date(Date.UTC(2026, 8, 15)), strong: true },
    ]);
    expect(models?.slice(3)).toEqual([
      { kind: "text", text: "Seed germination" },
      { kind: "text", text: "Rooting" },
    ]);
  });

  test("a day that counts some of its model's classes names them too", () => {
    const workbook = trial({
      observations: [SOWN, GERMINATED],
      images: [
        image("A1", SOWN.id, { ungerminated: 20 }),
        image("A1", GERMINATED.id, { ungerminated: 4, germinated: 15 }),
      ],
    });
    const [, questions] = heading(workbook);
    expect(questions?.slice(3)).toEqual([
      { kind: "text", text: "Seed germination" },
      { kind: "text", text: "Seed germination · Germinated" },
    ]);
    const [first] = readings(workbook);
    expect(first?.slice(3)).toEqual([
      { kind: "count", count: 20 },
      { kind: "count", count: 15 },
    ]);
  });

  test("every day is one column of counts beside the design", () => {
    const workbook = trial();
    expect(workbook.columns).toHaveLength(5);
    expect(workbook.stickyColumns).toBe(3);
  });

  test("a row per unit, each reading its own tallies", () => {
    const rows = readings(trial());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([
      { kind: "text", text: "CK" },
      { kind: "text", text: "BA 0 mg/L" },
      { kind: "text", text: "A1" },
      { kind: "count", count: 20 },
      { kind: "count", count: 15 },
    ]);
  });

  test("an excluded unit is named by the event", () => {
    const workbook = trial({
      units: [unit("A1"), unit("A2", CONTAMINATED)],
    });
    const [, second] = readings(workbook);
    expect(second?.slice(3)).toEqual([
      { kind: "count", count: 20 },
      { kind: "text", text: "Contaminated" },
    ]);
  });

  test("a unit with an unclear photograph says so on every day, unless the experiment counts it", () => {
    const images = [
      image("A1", SOWN.id, { ungerminated: 20 }),
      image("A2", SOWN.id, { ungerminated: 20 }),
      image("A1", ROOTED.id, { rooted: 15 }, true),
      image("A2", ROOTED.id, { rooted: 10 }),
    ];
    const [first, second] = readings(trial({ images }));
    // The record of the dish is in doubt, not one day of it.
    expect(first?.slice(3)).toEqual([
      { kind: "text", text: "Unclear" },
      { kind: "text", text: "Unclear" },
    ]);
    expect(second?.slice(3)).toEqual([
      { kind: "count", count: 20 },
      { kind: "count", count: 10 },
    ]);
    // Where unclear photographs count, the numbers stand.
    const [counted] = readings(
      trial({ experiment: { ...EXPERIMENT, countsUnclear: true }, images }),
    );
    expect(counted?.slice(3)).toEqual([
      { kind: "count", count: 20 },
      { kind: "count", count: 15 },
    ]);
  });

  test("a day an event takes out names the event, even in a unit out for an unclear photograph", () => {
    const [first] = readings(
      trial({
        units: [unit("A1", CONTAMINATED), unit("A2")],
        images: [
          image("A1", SOWN.id, { ungerminated: 20 }, true),
          image("A1", ROOTED.id, { rooted: 15 }),
        ],
      }),
    );
    expect(first?.slice(3)).toEqual([
      { kind: "text", text: "Unclear" },
      { kind: "text", text: "Contaminated" },
    ]);
  });

  test("an unclear photograph on a day an event already took out leaves the earlier days", () => {
    const [first] = readings(
      trial({
        units: [unit("A1", CONTAMINATED), unit("A2")],
        images: [
          image("A1", SOWN.id, { ungerminated: 20 }),
          image("A1", ROOTED.id, { rooted: 15 }, true),
        ],
      }),
    );
    expect(first?.slice(3)).toEqual([
      { kind: "count", count: 20 },
      { kind: "text", text: "Contaminated" },
    ]);
  });

  test("a day with no photograph is only that day without a number", () => {
    const [first] = readings(
      trial({ images: [image("A1", ROOTED.id, { rooted: 15 })] }),
    );
    expect(first?.slice(3)).toEqual([
      { kind: "blank" },
      { kind: "count", count: 15 },
    ]);
  });

  test("a count entered by hand is a count like any other", () => {
    const [first, second] = readings(
      trial({
        images: [image("A1", ROOTED.id, { rooted: 15 })],
        manualReadings: [
          {
            unit: "A1",
            observation: SOWN.id,
            tally: { ungerminated: 18, germinated: 0 },
            recordedAt: "2026-09-01T00:00:00.000Z",
          },
          {
            unit: "A2",
            observation: ROOTED.id,
            tally: { rooted: 9 },
            recordedAt: "2026-09-15T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(first?.slice(3)).toEqual([
      { kind: "count", count: 18 },
      { kind: "count", count: 15 },
    ]);
    expect(second?.slice(3)).toEqual([
      { kind: "blank" },
      { kind: "count", count: 9 },
    ]);
  });

  test("a reading still to come leaves its cell empty", () => {
    const workbook = trial({
      images: [
        image("A1", SOWN.id, { ungerminated: 20 }),
        image("A2", SOWN.id, { ungerminated: 20 }),
      ],
    });
    const [first] = readings(workbook);
    expect(first?.slice(4)).toEqual([{ kind: "blank" }]);
  });
});

describe("what the file is called", () => {
  test("is named for the experiment", () => {
    expect(experimentWorkbookFilename(EXPERIMENT)).toBe(
      "Germination trial.xlsx",
    );
  });

  test("falls back to what the page is called", () => {
    expect(experimentWorkbookFilename({ ...EXPERIMENT, name: "//" })).toBe(
      "Experiments.xlsx",
    );
  });
});

describe("the summary sheet", () => {
  const SUMMARY_HEADING_ROWS = 3;
  const germinating = () =>
    summary({
      observations: [SOWN, GERMINATED],
      images: [
        image("A1", SOWN.id, { ungerminated: 20 }),
        image("A2", SOWN.id, { ungerminated: 20 }),
        image("A1", GERMINATED.id, { ungerminated: 5, germinated: 15 }),
        image("A2", GERMINATED.id, { ungerminated: 10, germinated: 10 }),
      ],
    });

  test("comes second in the file, after the records", () => {
    const workbook = experimentWorkbook(source(), "2026-09-20");
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual([
      "Germination trial",
      "Summary",
    ]);
  });

  test("heads every day with its date over its measure over n, mean, SD and SE", () => {
    const sheet = germinating();
    const [dates, measures, statistics] = sheet.rows.slice(
      sheet.stickyRows - SUMMARY_HEADING_ROWS,
      sheet.stickyRows,
    );
    expect(dates).toEqual([
      { kind: "text", text: "Treatment", strong: true, rows: 3 },
      { kind: "text", text: "Factor", strong: true, rows: 3 },
      {
        kind: "date",
        date: new Date(Date.UTC(2026, 8, 1)),
        strong: true,
        columns: 4,
      },
      { kind: "blank" },
      { kind: "blank" },
      { kind: "blank" },
      {
        kind: "date",
        date: new Date(Date.UTC(2026, 8, 8)),
        strong: true,
        columns: 4,
      },
      { kind: "blank" },
      { kind: "blank" },
      { kind: "blank" },
    ]);
    expect(measures?.slice(2)).toEqual([
      { kind: "text", text: "Count", strong: true, columns: 4 },
      { kind: "blank" },
      { kind: "blank" },
      { kind: "blank" },
      { kind: "text", text: "Rate", strong: true, columns: 4 },
      { kind: "blank" },
      { kind: "blank" },
      { kind: "blank" },
    ]);
    expect(
      statistics?.slice(2, 6).map((cell) => cell.kind === "text" && cell.text),
    ).toEqual(["n", "Mean", "SD", "SE"]);
    expect(sheet.stickyColumns).toBe(2);
    expect(sheet.columns).toHaveLength(2 + 2 * 4);
  });

  test("a row per treatment: counts on the first day, rates after it", () => {
    const sheet = germinating();
    const [row] = sheet.rows.slice(sheet.stickyRows);
    expect(row?.slice(0, 6)).toEqual([
      { kind: "text", text: "CK" },
      { kind: "text", text: "BA 0 mg/L" },
      { kind: "count", count: 2 },
      { kind: "decimal", value: 20, digits: 1 },
      { kind: "decimal", value: 0, digits: 1 },
      { kind: "decimal", value: 0, digits: 1 },
    ]);
    const [n, mean, sd, se] = row?.slice(6) ?? [];
    expect(n).toEqual({ kind: "count", count: 2 });
    expect(mean).toEqual({ kind: "ratio", ratio: 0.625 });
    expect(sd?.kind === "ratio" && sd.ratio).toBeCloseTo(0.1768, 4);
    expect(se?.kind === "ratio" && se.ratio).toBeCloseTo(0.125, 4);
  });

  test("a day read for another model is summarised by its counts", () => {
    const sheet = summary();
    const [, measures] = sheet.rows.slice(
      sheet.stickyRows - SUMMARY_HEADING_ROWS,
    );
    expect(measures?.[6]).toEqual({
      kind: "text",
      text: "Count",
      strong: true,
      columns: 4,
    });
    const [row] = sheet.rows.slice(sheet.stickyRows);
    expect(row?.slice(6)).toEqual([
      { kind: "count", count: 2 },
      { kind: "decimal", value: 12.5, digits: 1 },
      { kind: "decimal", value: Math.sqrt(12.5), digits: 1 },
      { kind: "decimal", value: Math.sqrt(12.5) / Math.sqrt(2), digits: 1 },
    ]);
  });

  test("a single unit has a mean and no spread, and a unit out of the analysis is not counted", () => {
    const sheet = summary({
      units: [unit("A1"), unit("A2", CONTAMINATED)],
    });
    const [row] = sheet.rows.slice(sheet.stickyRows);
    expect(row?.slice(6)).toEqual([
      { kind: "count", count: 1 },
      { kind: "decimal", value: 15, digits: 1 },
      { kind: "blank" },
      { kind: "blank" },
    ]);
  });

  test("a treatment with nothing read that day leaves the day blank", () => {
    const sheet = summary({ images: [] });
    const [row] = sheet.rows.slice(sheet.stickyRows);
    expect(row?.slice(2)).toEqual(Array(8).fill({ kind: "blank" }));
  });

  test("says under the table how the numbers were taken", () => {
    const sheet = germinating();
    const notes = sheet.rows.slice(sheet.stickyRows + 1);
    expect(notes).toEqual([
      [],
      [
        {
          kind: "text",
          text: "Mean ± standard deviation over the treatment's units in the analysis; n is how many.",
        },
      ],
      [
        {
          kind: "text",
          text: "Rate = the day's count ÷ the same unit's count on the first observation (Sep 1, 2026). The first observation is summarised as a count.",
        },
      ],
    ]);
  });
});
