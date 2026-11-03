import { describe, expect, test } from "bun:test";

import type { CultureEvent } from "./culture-events";
import type { ExperimentGridDetail, ObservationImageCell } from "./read-model";
import type {
  Experiment,
  ExperimentObservation,
  ManualReading,
} from "./schema";
import { experimentSummary, statistic, summaryCell } from "./summary";

const experiment: Experiment = {
  id: "experiment",
  name: "Summary",
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
  modelId = "seed-detector",
): ExperimentObservation {
  return {
    id: `day-${ordinal}`,
    ordinal,
    observedOn: `2026-09-0${ordinal}`,
    note: "",
    modelId,
    countedClasses: counted,
    hasRecords: true,
  };
}

const sown = observation(1, ["ungerminated", "germinated"]);
const grown = observation(2, ["germinated"]);
const rooted = observation(3, ["rooted"], "rooting");

function photograph(
  unit: string,
  day: ExperimentObservation,
  tally: Record<string, number>,
  overrides: Partial<ObservationImageCell> = {},
): ObservationImageCell {
  return {
    id: `${unit}-${day.id}`,
    unit,
    observation: day.id,
    digest: "a".repeat(64),
    filename: `${unit}.jpg`,
    state: "analyzed",
    detectionTally: tally,
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

/** Three dishes of one treatment: 10, 20 and 40 seeds sown, 5, 15 and 40 germinated. */
const DISHES = [
  photograph("a", sown, { ungerminated: 10 }),
  photograph("b", sown, { ungerminated: 20 }),
  photograph("c", sown, { ungerminated: 40 }),
  photograph("a", grown, { ungerminated: 5, germinated: 5 }),
  photograph("b", grown, { ungerminated: 5, germinated: 15 }),
  photograph("c", grown, { germinated: 40 }),
];

function grid(
  overrides: Partial<ExperimentGridDetail> = {},
): ExperimentGridDetail {
  return {
    experiment,
    treatments: [
      { id: "t", name: "Treated", factor: null, note: "", position: 1 },
      { id: "c", name: "Control", factor: null, note: "", position: 2 },
    ],
    units: [
      { id: "a", code: "T-1", treatment: "t", events: [] },
      { id: "b", code: "T-2", treatment: "t", events: [] },
      { id: "c", code: "T-3", treatment: "t", events: [] },
      { id: "k", code: "C-1", treatment: "c", events: [] },
    ],
    observations: [sown, grown],
    images: DISHES,
    manualReadings: [],
    ...overrides,
  };
}

function cell(
  summary: ReturnType<typeof experimentSummary>,
  treatment: string,
  day: ExperimentObservation,
) {
  const found = summaryCell(summary, treatment, day.id);
  if (!found) throw new Error(`No summary for ${treatment} on ${day.id}`);
  return found;
}

describe("a statistic", () => {
  test("is nothing over no values", () => {
    expect(statistic([])).toBeNull();
  });

  test("a single value has a mean and no spread", () => {
    expect(statistic([0.5])).toEqual({ n: 1, mean: 0.5, sd: null, se: null });
  });

  test("spreads by the sample standard deviation", () => {
    const stat = statistic([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(stat?.n).toBe(8);
    expect(stat?.mean).toBe(5);
    expect(stat?.sd).toBeCloseTo(2.138, 3);
    expect(stat?.se).toBeCloseTo(0.756, 3);
  });
});

describe("the summary by treatment", () => {
  test("has a cell for every treatment on every observation, treatments in the design's order", () => {
    const summary = experimentSummary(grid());
    expect(summary.baseline).toBe(sown.id);
    expect(
      summary.cells.map(
        ({ treatment, observation }) => `${treatment}/${observation}`,
      ),
    ).toEqual(["t/day-1", "t/day-2", "c/day-1", "c/day-2"]);
  });

  test("summarises the counts of the first observation, which has no rate", () => {
    const first = cell(experimentSummary(grid()), "t", sown);
    expect(first.units).toEqual([
      { unit: "a", count: 10, rate: null },
      { unit: "b", count: 20, rate: null },
      { unit: "c", count: 40, rate: null },
    ]);
    expect(first.count?.n).toBe(3);
    expect(first.count?.mean).toBeCloseTo(23.333, 3);
    expect(first.rate).toBeNull();
  });

  test("rates a later day against each unit's own first count, then averages the rates", () => {
    const later = cell(experimentSummary(grid()), "t", grown);
    expect(later.units).toEqual([
      { unit: "a", count: 5, rate: 0.5 },
      { unit: "b", count: 15, rate: 0.75 },
      { unit: "c", count: 40, rate: 1 },
    ]);
    expect(later.count).toEqual({
      n: 3,
      mean: 20,
      sd: expect.closeTo(18.028, 3),
      se: expect.closeTo(10.408, 3),
    });
    expect(later.rate?.n).toBe(3);
    expect(later.rate?.mean).toBe(0.75);
    expect(later.rate?.sd).toBe(0.25);
  });

  test("a treatment with nothing read has an empty cell", () => {
    const control = cell(experimentSummary(grid()), "c", grown);
    expect(control).toEqual({
      treatment: "c",
      observation: grown.id,
      units: [],
      count: null,
      rate: null,
    });
  });

  test("a unit out of the analysis is not among the treatment's units that day", () => {
    const summary = experimentSummary(
      grid({
        units: [
          { id: "a", code: "T-1", treatment: "t", events: [] },
          {
            id: "b",
            code: "T-2",
            treatment: "t",
            events: [event("contaminated", grown)],
          },
          { id: "c", code: "T-3", treatment: "t", events: [] },
          { id: "k", code: "C-1", treatment: "c", events: [] },
        ],
      }),
    );
    expect(cell(summary, "t", sown).count?.n).toBe(3);
    expect(cell(summary, "t", grown).units.map((unit) => unit.unit)).toEqual([
      "a",
      "c",
    ]);
    expect(cell(summary, "t", grown).rate).toEqual({
      n: 2,
      mean: 0.75,
      sd: expect.closeTo(0.3536, 3),
      se: expect.closeTo(0.25, 3),
    });
  });

  test("an unclear photograph takes its unit out on every day, unless the experiment counts it", () => {
    const images = [
      ...DISHES.filter((image) => image.unit !== "a"),
      photograph("a", sown, { ungerminated: 10 }),
      photograph("a", grown, { germinated: 5 }, { unclear: true }),
    ];
    const out = experimentSummary(grid({ images }));
    expect(cell(out, "t", sown).count?.n).toBe(2);
    expect(cell(out, "t", grown).count?.n).toBe(2);
    const counted = experimentSummary(
      grid({ images, experiment: { ...experiment, countsUnclear: true } }),
    );
    expect(cell(counted, "t", grown).count?.n).toBe(3);
  });

  test("a single unit has a mean and no spread", () => {
    const summary = experimentSummary(
      grid({
        images: [
          photograph("k", sown, { ungerminated: 8 }),
          photograph("k", grown, { germinated: 6 }),
        ],
      }),
    );
    expect(cell(summary, "c", grown).rate).toEqual({
      n: 1,
      mean: 0.75,
      sd: null,
      se: null,
    });
  });

  test("a count entered by hand counts like a photograph's", () => {
    const summary = experimentSummary(
      grid({
        images: DISHES.filter((image) => image.observation !== grown.id),
        manualReadings: [
          counted("a", grown, { germinated: 10 }),
          counted("b", grown, { germinated: 10 }),
        ],
      }),
    );
    expect(cell(summary, "t", grown).units).toEqual([
      { unit: "a", count: 10, rate: 1 },
      { unit: "b", count: 10, rate: 0.5 },
    ]);
  });

  test("a day read for another model has counts but no rate", () => {
    const summary = experimentSummary(
      grid({
        observations: [sown, grown, rooted],
        images: [...DISHES, photograph("a", rooted, { rooted: 3 })],
      }),
    );
    const roots = cell(summary, "t", rooted);
    expect(roots.units).toEqual([{ unit: "a", count: 3, rate: null }]);
    expect(roots.count?.mean).toBe(3);
    expect(roots.rate).toBeNull();
  });

  test("a unit that counted nothing on the first day has no rate", () => {
    const summary = experimentSummary(
      grid({
        images: [
          photograph("k", sown, {}),
          photograph("k", grown, { germinated: 2 }),
        ],
      }),
    );
    expect(cell(summary, "c", grown).units).toEqual([
      { unit: "k", count: 2, rate: null },
    ]);
  });

  test("a unit not read on the first day has no rate on any day", () => {
    const summary = experimentSummary(
      grid({ images: [photograph("k", grown, { germinated: 2 })] }),
    );
    expect(cell(summary, "c", grown).units).toEqual([
      { unit: "k", count: 2, rate: null },
    ]);
  });

  test("an experiment without observations has no baseline and no cells", () => {
    expect(experimentSummary(grid({ observations: [], images: [] }))).toEqual({
      baseline: null,
      cells: [],
    });
  });
});
