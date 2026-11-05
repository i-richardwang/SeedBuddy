import { describe, expect, test } from "bun:test";

import { type PlacedPhoto, photoConflicts } from "./photos";

const digest = (char: string) => char.repeat(64);

const placed: PlacedPhoto[] = [
  {
    digest: digest("a"),
    filename: "IMG_0412.jpg",
    unit: "A-1",
    observedOn: "2026-09-06",
  },
];

describe("photographs an experiment holds", () => {
  test("a photograph the experiment holds names where it is", () => {
    const conflicts = photoConflicts(
      [{ id: 1, digest: digest("a"), filename: "copy.jpg" }],
      placed,
    );
    expect(conflicts.get(1)).toEqual({ kind: "placed", placed: placed[0]! });
  });

  test("a batch keeps the first copy of a photograph and flags the rest", () => {
    const conflicts = photoConflicts(
      [
        { id: 1, digest: digest("b"), filename: "IMG_0413.jpg" },
        { id: 2, digest: digest("b"), filename: "IMG_0413 copy.jpg" },
        { id: 3, digest: digest("c"), filename: "IMG_0414.jpg" },
      ],
      placed,
    );
    expect([...conflicts]).toEqual([
      [2, { kind: "repeated", filename: "IMG_0413.jpg" }],
    ]);
  });
});
