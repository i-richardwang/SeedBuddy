import { describe, expect, test } from "bun:test";

import {
  type AnalysisFrame,
  analysisFrame,
  baselineDays,
  dayAnalysis,
  unitAnalysis,
} from "./analysis";
import type { UnitDay } from "./cell-reading";
import type { CultureEvent } from "./culture-events";
import type { ExperimentObservation } from "./schema";
import { counted, event, observation, photograph } from "./testing";

const SOWN = ["ungerminated", "germinated", "dead"];
const days = [
  observation(1, SOWN),
  observation(2, ["germinated"]),
  observation(3, ["germinated"]),
];
const [day1, day2, day3] = days as [
  ExperimentObservation,
  ExperimentObservation,
  ExperimentObservation,
];
const frame = analysisFrame({ countsUnclear: false }, days);
const counting: AnalysisFrame = {
  ...frame,
  experiment: { countsUnclear: true },
};

/** The dish: 20 seeds sown, 8 germinated by the second day and 12 by the third. */
const TALLIES: Record<string, number>[] = [
  { ungerminated: 20 },
  { ungerminated: 11, germinated: 8, dead: 1 },
  { ungerminated: 7, germinated: 12, dead: 1 },
];

/** The unit photographed on every day, unclear on the days named. */
function photographed(
  unclearOn: readonly ExperimentObservation[] = [],
): UnitDay[] {
  return days.map((observation, index) => ({
    observation,
    image: photograph("dish", observation, {
      detectionTally: TALLIES[index]!,
      unclear: unclearOn.includes(observation),
    }),
    manual: null,
  }));
}

function reasons(
  unit: readonly UnitDay[],
  events: readonly CultureEvent[] = [],
  against = frame,
) {
  return unit.map(
    (day) => dayAnalysis(events, day, against).exclusion?.reason ?? null,
  );
}

describe("why a unit's day stays out of the analysis", () => {
  test("nothing keeps a clear unit out", () => {
    expect(reasons(photographed())).toEqual([null, null, null]);
  });

  test("an unclear photograph takes out its own day and no other", () => {
    expect(reasons(photographed([day2]))).toEqual([null, "unclear", null]);
  });

  test("where the experiment counts unclear photographs, nothing", () => {
    expect(reasons(photographed([day2]), [], counting)).toEqual([
      null,
      null,
      null,
    ]);
  });

  test("a count entered by hand stands whatever the day's photograph shows", () => {
    const unit = photographed([day2]).map((day) =>
      day.observation === day2
        ? { ...day, manual: counted("dish", day2, { germinated: 9 }) }
        : day,
    );
    expect(dayAnalysis([], unit[1]!, frame)).toEqual({
      reading: { count: 9, source: "manual", unfound: [] },
      exclusion: null,
    });
  });

  test("an entered count that leaves out a class the day counts does not stand in for an unclear photograph", () => {
    const unit = photographed([day1]).map((day) =>
      day.observation === day1
        ? { ...day, manual: counted("dish", day1, { ungerminated: 20 }) }
        : day,
    );
    expect(dayAnalysis([], unit[0]!, frame).exclusion).toEqual({
      reason: "unclear",
    });
  });

  test("a day with no photograph keeps nothing out", () => {
    const missing = photographed().map((day) =>
      day.observation === day2 ? { ...day, image: null } : day,
    );
    expect(reasons(missing)).toEqual([null, null, null]);
  });

  test("a day an event takes out names the event, unclear or not", () => {
    const contaminated = event("contaminated", day2);
    const unit = photographed([day1, day3]);
    expect(reasons(unit, [contaminated])).toEqual([
      "unclear",
      "event",
      "event",
    ]);
    expect(dayAnalysis([contaminated], unit[2]!, frame).exclusion).toEqual({
      reason: "event",
      event: contaminated,
    });
  });
});

/** What the unit's rates are taken over, naming `baseline` or the first observation. */
function baselineOf(
  unit: readonly UnitDay[],
  baseline: string | null = null,
  events: readonly CultureEvent[] = [],
) {
  return unitAnalysis({ events, baseline }, unit, frame).baseline;
}

describe("what a unit's rates are taken over", () => {
  test("nothing before any observation", () => {
    expect(unitAnalysis({ events: [], baseline: null }, [], frame)).toEqual({
      days: [],
      baseline: null,
    });
  });

  test("its count on the first observation", () => {
    expect(baselineOf(photographed())).toEqual({
      observation: day1.id,
      count: 20,
      source: "detection",
      gap: null,
      named: false,
      wanted: false,
    });
  });

  test("no number where the first photograph is unclear", () => {
    // The later days have numbers and nothing to rate them by.
    expect(baselineOf(photographed([day1]))).toEqual({
      observation: day1.id,
      count: null,
      source: null,
      gap: "unclear",
      named: false,
      wanted: true,
    });
  });

  test("the observation the unit names, counted over the classes the first observation counts", () => {
    expect(baselineOf(photographed([day1]), day2.id)).toEqual({
      observation: day2.id,
      count: 20,
      source: "detection",
      gap: null,
      named: true,
      wanted: false,
    });
  });

  test("an entered count on the day named gives it only where it answers those classes", () => {
    const entered = (tally: Record<string, number>) =>
      photographed([day1, day2]).map((day) =>
        day.observation === day2
          ? { ...day, manual: counted("dish", day2, tally) }
          : day,
      );
    // The day's own count answers the day and leaves the baseline to the
    // photograph, which is unclear.
    expect(baselineOf(entered({ germinated: 8 }), day2.id)?.count).toBe(null);
    expect(
      baselineOf(entered({ ungerminated: 10, germinated: 8, dead: 1 }), day2.id)
        ?.count,
    ).toBe(19);
  });

  test("no number from a day read for another model than the first", () => {
    const rooted = observation(3, ["rooted"], "rooting");
    const unit = [
      ...photographed().slice(0, 2),
      {
        observation: rooted,
        image: photograph("dish", rooted, { detectionTally: { rooted: 3 } }),
        manual: null,
      },
    ];
    expect(baselineOf(unit, rooted.id)).toMatchObject({
      count: null,
      gap: "model",
    });
  });

  test("says why it has no number, and is wanted only where a rate waits on it", () => {
    const gap = (unit: UnitDay[], events: CultureEvent[] = []) => {
      const { gap, wanted } = baselineOf(unit, null, events)!;
      return [gap, wanted];
    };
    const unread = photographed().map((day) =>
      day.observation === day1 ? { ...day, image: null } : day,
    );
    expect(gap(unread)).toEqual(["unread", true]);
    // Nothing read after the first day either: no rate is lost.
    expect(gap(unread.map((day) => ({ ...day, image: null })))).toEqual([
      "unread",
      false,
    ]);
    // A unit out from the first day has no day to rate.
    expect(gap(photographed(), [event("contaminated", day1)])).toEqual([
      "event",
      false,
    ]);
  });

  test("each day says what it would give, were the unit to name it", () => {
    const offered = baselineDays([], photographed([day1]), frame);
    expect([...offered.keys()]).toEqual(days.map((day) => day.id));
    expect(offered.get(day1.id)).toMatchObject({ count: null, gap: "unclear" });
    expect(offered.get(day2.id)).toMatchObject({ count: 20, gap: null });
    expect(offered.get(day3.id)).toMatchObject({ count: 20, gap: null });
  });
});

describe("a unit's rate on a day", () => {
  const rates = (unit: readonly UnitDay[], baseline: string | null = null) =>
    unitAnalysis({ events: [], baseline }, unit, frame).days.map(
      (day) => day.rate,
    );

  test("is the day's count over the first day's, and none on the first", () => {
    expect(rates(photographed())).toEqual([null, 0.4, 0.6]);
  });

  test("an unclear day between two clear ones loses only its own", () => {
    expect(rates(photographed([day2]))).toEqual([null, null, 0.6]);
  });

  test("an unclear first day leaves the unit without rates until it names another", () => {
    expect(rates(photographed([day1]))).toEqual([null, null, null]);
    expect(rates(photographed([day1]), day2.id)).toEqual([null, 0.4, 0.6]);
  });

  test("a day keeps its reading and exclusion beside its rate", () => {
    const [, second] = unitAnalysis(
      { events: [], baseline: null },
      photographed([day2]),
      frame,
    ).days;
    expect(second).toEqual({
      ...dayAnalysis([], photographed([day2])[1]!, frame),
      rate: null,
    });
  });
});
