import { describe, expect, test } from "bun:test";

import { unitExclusions } from "./analysis";
import type { UnitDay } from "./cell-reading";
import type { CultureEvent } from "./culture-events";
import { observationOrdinals } from "./culture-events";
import type { ObservationImageCell } from "./read-model";
import type { ExperimentObservation } from "./schema";

function observation(ordinal: number): ExperimentObservation {
  return {
    id: `observation-${ordinal}`,
    ordinal,
    observedOn: `2026-09-0${ordinal}`,
    note: "",
    modelId: "seed-detector",
    countedClasses: ["germinated"],
    hasRecords: true,
  };
}

const days = [observation(1), observation(2), observation(3)];
const [day1, day2, day3] = days as [
  ExperimentObservation,
  ExperimentObservation,
  ExperimentObservation,
];
const ordinals = observationOrdinals(days);
const notCounted = { countsUnclear: false };

function event(
  type: CultureEvent["type"],
  on: ExperimentObservation,
): CultureEvent {
  return {
    id: `${type}-${on.id}`,
    type,
    observation: on.id,
    recordedAt: "2026-09-01T00:00:00.000Z",
  };
}

function photograph(
  observation: ExperimentObservation,
  unclear: boolean,
): ObservationImageCell {
  return {
    id: `dish-${observation.id}`,
    unit: "dish",
    observation: observation.id,
    digest: "a".repeat(64),
    filename: "IMG_0001.JPG",
    state: "analyzed",
    detectionTally: { germinated: 4 },
    proposalTally: null,
    annotationTally: null,
    error: null,
    unclear,
  };
}

/** The unit photographed on every day, unclear on the days named. */
function photographed(
  unclearOn: readonly ExperimentObservation[] = [],
): UnitDay[] {
  return days.map((observation) => ({
    observation,
    image: photograph(observation, unclearOn.includes(observation)),
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
