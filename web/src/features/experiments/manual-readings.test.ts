import { describe, expect, test } from "bun:test";

import type { ManualReading } from "../../domain/experiments/schema";
import { manualReadingDraft, manualReadingEntries } from "./manual-readings";

const CLASSES = ["ungerminated", "germinated"];

function held(unit: string, tally: ManualReading["tally"]): ManualReading {
  return {
    unit,
    observation: "day0",
    tally,
    recordedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("what the form opens with", () => {
  test("the count a unit already has, class by class", () => {
    expect(
      manualReadingDraft(
        CLASSES,
        held("A1", { ungerminated: 18, germinated: 2 }),
      ),
    ).toEqual({ ungerminated: 18, germinated: 2 });
  });

  test("nothing for a unit without one, or for a class its count never gave", () => {
    expect(manualReadingDraft(CLASSES, null)).toEqual({
      ungerminated: null,
      germinated: null,
    });
    expect(manualReadingDraft(CLASSES, held("A1", { germinated: 2 }))).toEqual({
      ungerminated: null,
      germinated: 2,
    });
  });
});

describe("what the form records", () => {
  const existing = new Map([
    ["A1", held("A1", { ungerminated: 18, germinated: 2 })],
    ["A2", held("A2", { ungerminated: 20, germinated: 0 })],
  ]);

  test("a unit filled in is counted, and one emptied withdraws its count", () => {
    const drafts = new Map([
      ["A1", { ungerminated: 17, germinated: 3 }],
      ["A2", { ungerminated: null, germinated: null }],
      ["A3", { ungerminated: 19, germinated: 1 }],
    ]);
    expect(manualReadingEntries(CLASSES, drafts, existing)).toEqual({
      entries: [
        { unit: "A1", tally: { ungerminated: 17, germinated: 3 } },
        { unit: "A2", tally: null },
        { unit: "A3", tally: { ungerminated: 19, germinated: 1 } },
      ],
      incomplete: [],
    });
  });

  test("a unit left as it was, or never counted and left empty, records nothing", () => {
    const drafts = new Map([
      ["A1", { ungerminated: 18, germinated: 2 }],
      ["A3", { ungerminated: null, germinated: null }],
    ]);
    expect(manualReadingEntries(CLASSES, drafts, existing)).toEqual({
      entries: [],
      incomplete: [],
    });
  });

  test("a unit filled in part is named rather than counted", () => {
    const drafts = new Map([["A3", { ungerminated: 19, germinated: null }]]);
    expect(manualReadingEntries(CLASSES, drafts, existing)).toEqual({
      entries: [],
      incomplete: ["A3"],
    });
  });

  test("a class the day no longer counts keeps the number the count gave it", () => {
    const drafts = new Map([["A1", { germinated: 5 }]]);
    expect(manualReadingEntries(["germinated"], drafts, existing)).toEqual({
      entries: [{ unit: "A1", tally: { ungerminated: 18, germinated: 5 } }],
      incomplete: [],
    });
  });
});
