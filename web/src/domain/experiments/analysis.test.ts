import { describe, expect, test } from "bun:test";

import { unitExclusions } from "./analysis";
import type { UnitDay } from "./cell-reading";
import { observationOrdinals } from "./culture-events";
import type { ExperimentObservation } from "./schema";
import { event, observation, photograph } from "./testing";

const days = [1, 2, 3].map((n) => observation(n, ["germinated"]));
const [day1, day2, day3] = days as [
  ExperimentObservation,
  ExperimentObservation,
  ExperimentObservation,
];
const ordinals = observationOrdinals(days);
const notCounted = { countsUnclear: false };

/** The unit photographed on every day, unclear on the days named. */
function photographed(
  unclearOn: readonly ExperimentObservation[] = [],
): UnitDay[] {
  return days.map((observation) => ({
    observation,
    image: photograph("dish", observation, {
      detectionTally: { germinated: 4 },
      unclear: unclearOn.includes(observation),
    }),
    manual: null,
  }));
}

function reasons(exclusion: ReturnType<typeof unitExclusions>) {
  return days.map((day) => exclusion(day)?.reason ?? null);
}

describe("why a unit's day stays out of the analysis", () => {
  test("nothing keeps a clear unit out", () => {
    expect(
      reasons(unitExclusions([], photographed(), ordinals, notCounted)),
    ).toEqual([null, null, null]);
  });

  test("an unclear photograph takes the whole unit out, before and after it", () => {
    expect(
      reasons(unitExclusions([], photographed([day2]), ordinals, notCounted)),
    ).toEqual(["unclear", "unclear", "unclear"]);
  });

  test("where the experiment counts unclear photographs, nothing", () => {
    expect(
      reasons(
        unitExclusions([], photographed([day2]), ordinals, {
          countsUnclear: true,
        }),
      ),
    ).toEqual([null, null, null]);
  });

  test("a day with no photograph keeps nothing out", () => {
    const missing = photographed().map((day) =>
      day.observation === day2 ? { ...day, image: null } : day,
    );
    expect(reasons(unitExclusions([], missing, ordinals, notCounted))).toEqual([
      null,
      null,
      null,
    ]);
  });

  test("a day an event takes out names the event", () => {
    const contaminated = event("contaminated", day3);
    const exclusion = unitExclusions(
      [contaminated],
      photographed([day1]),
      ordinals,
      notCounted,
    );
    expect(reasons(exclusion)).toEqual(["unclear", "unclear", "event"]);
    expect(exclusion(day3)).toEqual({ reason: "event", event: contaminated });
  });

  test("an unclear photograph after an event took the unit out leaves the earlier days", () => {
    expect(
      reasons(
        unitExclusions(
          [event("contaminated", day2)],
          photographed([day3]),
          ordinals,
          notCounted,
        ),
      ),
    ).toEqual([null, "event", "event"]);
  });

  test("a harvested unit's last day still counts its photograph", () => {
    expect(
      reasons(
        unitExclusions(
          [event("harvested", day2)],
          photographed([day2]),
          ordinals,
          notCounted,
        ),
      ),
    ).toEqual(["unclear", "unclear", "event"]);
  });
});
