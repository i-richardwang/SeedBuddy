import { describe, expect, test } from "bun:test";

import type {
  ObservationImageCell,
  Unit,
} from "../../domain/experiments/contracts";
import type {
  Experiment,
  ExperimentObservation,
  Treatment,
} from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import type { WorkbookCell } from "../../lib/spreadsheet/workbook";
import {
  experimentWorkbook,
  experimentWorkbookFilename,
  type ExperimentWorkbookSource,
} from "./workbook";
import { DEFAULT_MODEL_ANNOTATION } from "../../domain/models/schema";

const HEADING_ROWS = 2;

const SEEDS: Model = {
  schemaVersion: 1,
  id: "seed-detector",
  name: "Seed germination",
  task: "object_detection",
  classes: ["ungerminated", "germinated"],
  annotation: DEFAULT_MODEL_ANNOTATION,
};

const ROOTS: Model = {
  schemaVersion: 1,
  id: "rooting",
  name: "Rooting",
  task: "object_detection",
  classes: ["rooted"],
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
    proposalTally: null,
    annotationTally: null,
    error: null,
    unclear,
  };
}

function trial(overrides: Partial<ExperimentWorkbookSource> = {}) {
  return experimentWorkbook(
    {
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
    },
    "2026-09-20",
  );
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
