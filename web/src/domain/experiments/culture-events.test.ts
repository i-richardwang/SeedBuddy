import { describe, expect, test } from "bun:test";

import {
  cultureEventExcludesFromAnalysis,
  cultureEventIsTerminal,
  excludingEvent,
  latestCultureEvent,
  unitIsAvailableAt,
  unitIsAvailableOn,
} from "./culture-events";
import {
  CULTURE_EVENT_TYPES,
  type CultureEvent,
  type ExperimentObservation,
} from "./schema";

const observations: ExperimentObservation[] = [
  {
    id: "5c5065a2-194d-4473-a48e-5ecbc9e8827d",
    ordinal: 1,
    observedOn: "2026-08-08",
    note: "",
    modelId: "seed-detector",
    countedClasses: ["ungerminated", "germinated"],
    hasRecords: true,
  },
  {
    id: "71f62341-1071-4641-aa80-ac3b7f9c73e8",
    ordinal: 2,
    observedOn: "2026-08-15",
    note: "",
    modelId: "seed-detector",
    countedClasses: ["ungerminated", "germinated"],
    hasRecords: false,
  },
];

const ordinals = new Map(
  observations.map((observation) => [observation.id, observation.ordinal]),
);

function event(overrides: Partial<CultureEvent>): CultureEvent {
  return {
    id: "d7863741-fbc8-439b-8a43-de9f3dfb613c",
    type: "discarded",
    observation: observations[0]!.id,
    recordedAt: "2026-08-08T12:00:00.000Z",
    ...overrides,
  };
}

describe("unit event effects", () => {
  test("each event type has one stable domain meaning", () => {
    expect(
      CULTURE_EVENT_TYPES.map((type) => [
        type,
        cultureEventIsTerminal(type),
        cultureEventExcludesFromAnalysis(type),
      ]),
    ).toEqual([
      ["contaminated", false, true],
      ["nonviable", false, false],
      ["discarded", true, true],
      ["harvested", true, false],
      ["missing", true, true],
    ]);
  });

  test("an event that takes the unit off the bench applies afterwards", () => {
    const events = [event({ type: "harvested" })];

    expect(unitIsAvailableAt(events, observations[0]!, ordinals)).toBeTrue();
    expect(excludingEvent(events, observations[0]!, ordinals)).toBeNull();
    expect(unitIsAvailableAt(events, observations[1]!, ordinals)).toBeFalse();
    expect(excludingEvent(events, observations[1]!, ordinals)).not.toBeNull();
  });

  test("a day not yet recorded follows the same rule by its date", () => {
    const events = [event({ type: "harvested" })];

    expect(unitIsAvailableOn(events, "2026-08-08", observations)).toBeTrue();
    expect(unitIsAvailableOn(events, "2026-08-09", observations)).toBeFalse();
    expect(
      unitIsAvailableOn(
        [event({ type: "contaminated" })],
        "2026-08-09",
        observations,
      ),
    ).toBeTrue();
  });

  test("an event the unit survives leaves it on the bench", () => {
    const events = [event({ type: "contaminated" })];

    expect(unitIsAvailableAt(events, observations[1]!, ordinals)).toBeTrue();
  });

  test("analysis exclusion starts in the recorded observation", () => {
    const events = [event({ type: "contaminated" })];

    expect(unitIsAvailableAt(events, observations[0]!, ordinals)).toBeTrue();
    expect(excludingEvent(events, observations[0]!, ordinals)).not.toBeNull();
    expect(excludingEvent(events, observations[1]!, ordinals)).not.toBeNull();
  });

  test("the earliest event to exclude a unit is the one that decided it", () => {
    const contaminated = event({ type: "contaminated" });
    const discarded = event({
      id: "c5c4c280-6592-4de0-9193-f2677e7a3e31",
      observation: observations[1]!.id,
      type: "discarded",
    });

    expect(
      excludingEvent([discarded, contaminated], observations[1]!, ordinals),
    ).toBe(contaminated);
    expect(excludingEvent([discarded], observations[0]!, ordinals)).toBeNull();
  });

  test("current state follows observation time rather than entry time", () => {
    const laterObservation = event({
      id: "c5c4c280-6592-4de0-9193-f2677e7a3e31",
      observation: observations[1]!.id,
      recordedAt: "2026-08-15T12:00:00.000Z",
      type: "contaminated",
    });
    const retrospectiveEntry = event({
      recordedAt: "2026-08-16T12:00:00.000Z",
      type: "nonviable",
    });

    expect(
      latestCultureEvent([laterObservation, retrospectiveEntry], ordinals)?.id,
    ).toBe(laterObservation.id);
  });
});
