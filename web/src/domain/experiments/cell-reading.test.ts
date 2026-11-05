import { describe, expect, test } from "bun:test";

import { ClassInvalidError } from "../models/errors";
import {
  cellReading,
  cellReadingFromImage,
  countChange,
  observationCells,
  resolveCountedClasses,
  unitReading,
} from "./cell-reading";
import { photograph as cell, counted, observation } from "./testing";

const SEED_CLASSES = ["ungerminated", "germinated"];

/** What a reading looks like when nobody has reviewed the detection behind it. */
const unreviewed = (count: number) => ({
  count,
  source: "detection" as const,
});

describe("what a cell reads", () => {
  const day0 = observation(1);

  test("a day that names every class counts the whole tally", () => {
    const cells = observationCells(
      [
        cell("dish", day0.id, {
          detectionTally: { ungerminated: 12, germinated: 8 },
        }),
      ],
      [],
    );
    expect(unitReading(cells, "dish", day0)).toEqual(unreviewed(20));
  });

  test("a later day counts only the classes it names", () => {
    const day7 = observation(2, ["germinated"]);
    const cells = observationCells(
      [
        cell("dish", day7.id, {
          annotationTally: { ungerminated: 3, germinated: 15 },
        }),
      ],
      [],
    );
    expect(unitReading(cells, "dish", day7)).toEqual({
      count: 15,
      source: "review",
    });
  });

  test("a review replaces the AI's suggestion and the detection under it", () => {
    const cells = observationCells(
      [
        cell("dish", day0.id, {
          detectionTally: { ungerminated: 19 },
          proposalTally: { ungerminated: 21 },
          annotationTally: { ungerminated: 20 },
        }),
      ],
      [],
    );
    expect(unitReading(cells, "dish", day0)).toEqual({
      count: 20,
      source: "review",
    });
  });

  test("an AI suggestion reads before the detection", () => {
    const cells = observationCells(
      [
        cell("dish", day0.id, {
          detectionTally: { ungerminated: 19 },
          proposalTally: { ungerminated: 21 },
        }),
      ],
      [],
    );
    expect(unitReading(cells, "dish", day0)).toEqual({
      count: 21,
      source: "proposal",
    });
  });

  test("a photograph not yet counted, or none, reads nothing", () => {
    const cells = observationCells([cell("dish", day0.id)], []);
    expect(unitReading(cells, "dish", day0)).toBeNull();
    expect(unitReading(cells, "other", day0)).toBeNull();
  });
});

describe("what a count entered by hand reads", () => {
  const day0 = observation(1);
  const day7 = observation(2, ["germinated"]);

  test("a unit counted by hand reads that count, with no photograph at all", () => {
    const cells = observationCells(
      [],
      [counted("dish", day7.id, { germinated: 14 })],
    );
    expect(unitReading(cells, "dish", day7)).toEqual({
      count: 14,
      source: "manual",
    });
  });

  test("a person's count outranks every reading of the photograph", () => {
    const cells = observationCells(
      [
        cell("dish", day0.id, {
          detectionTally: { ungerminated: 19 },
          proposalTally: { ungerminated: 21 },
          annotationTally: { ungerminated: 20 },
        }),
      ],
      [counted("dish", day0.id, { ungerminated: 18, germinated: 0 })],
    );
    expect(unitReading(cells, "dish", day0)).toEqual({
      count: 18,
      source: "manual",
    });
    expect(cells.get("dish:day-1")?.image).not.toBeNull();
  });

  test("the classes the day counts, out of all the count names", () => {
    const cells = observationCells(
      [],
      [counted("dish", day7.id, { ungerminated: 3, germinated: 14 })],
    );
    expect(unitReading(cells, "dish", day7)).toEqual({
      count: 14,
      source: "manual",
    });
  });

  test("a class the day counts and the count never gave is unanswered, not zero", () => {
    const cells = observationCells(
      [],
      [counted("dish", day0.id, { germinated: 14 })],
    );
    expect(unitReading(cells, "dish", day0)).toBeNull();
  });

  test("where the count is unanswered, the photograph reads instead", () => {
    const cells = observationCells(
      [cell("dish", day0.id, { detectionTally: { ungerminated: 19 } })],
      [counted("dish", day0.id, { germinated: 14 })],
    );
    expect(unitReading(cells, "dish", day0)).toEqual(unreviewed(19));
  });

  test("a cell nobody photographed or counted reads nothing", () => {
    expect(cellReading(null, day7)).toBeNull();
    expect(cellReading({ image: null, manual: null }, day7)).toBeNull();
  });
});

describe("what a day's photograph reads", () => {
  test("the classes its day counts, from the best reading it has", () => {
    const day7 = observation(2, ["germinated"]);
    const image = cell("dish", day7.id, {
      detectionTally: { ungerminated: 4, germinated: 9 },
      proposalTally: { ungerminated: 3, germinated: 11 },
    });
    expect(cellReadingFromImage(image, day7)).toEqual({
      count: 11,
      source: "proposal",
    });
  });

  test("nothing without a photograph or a reading of it", () => {
    expect(cellReadingFromImage(null, observation(1))).toBeNull();
    const unread = cell("dish", "day-1");
    expect(cellReadingFromImage(unread, observation(1))).toBeNull();
  });
});

describe("how a unit's count changed between two days", () => {
  const day0 = observation(1, ["germinated"]);
  const day7 = observation(2, ["germinated"]);
  const before = cell("dish", day0.id, {
    annotationTally: { ungerminated: 20, germinated: 2 },
  });
  const after = cell("dish", day7.id, {
    detectionTally: { ungerminated: 6, germinated: 15 },
  });

  test("the later count less the earlier, whoever read each", () => {
    expect(
      countChange(
        { observation: day0, image: before, manual: null },
        { observation: day7, image: after, manual: null },
      ),
    ).toBe(13);
    expect(
      countChange(
        { observation: day7, image: after, manual: null },
        { observation: day0, image: before, manual: null },
      ),
    ).toBe(-13);
  });

  test("nothing when the days count different classes", () => {
    expect(
      countChange(
        { observation: observation(1), image: before, manual: null },
        { observation: day7, image: after, manual: null },
      ),
    ).toBeNull();
  });

  test("nothing when the days read with different models", () => {
    expect(
      countChange(
        { observation: day0, image: before, manual: null },
        {
          observation: observation(2, ["germinated"], "shoot-detector"),
          image: after,
          manual: null,
        },
      ),
    ).toBeNull();
  });

  test("nothing while either day has no reading", () => {
    expect(
      countChange(
        { observation: day0, image: null, manual: null },
        { observation: day7, image: after, manual: null },
      ),
    ).toBeNull();
  });

  test("a day counted by hand changes from one read from a photograph", () => {
    expect(
      countChange(
        { observation: day0, image: before, manual: null },
        {
          observation: day7,
          image: null,
          manual: counted("dish", day7.id, { germinated: 17 }),
        },
      ),
    ).toBe(15);
  });
});

describe("which classes a day counts", () => {
  test("every class its model recognizes, unless it names fewer", () => {
    expect(resolveCountedClasses(SEED_CLASSES, undefined)).toEqual(
      SEED_CLASSES,
    );
    expect(resolveCountedClasses(SEED_CLASSES, ["germinated"])).toEqual([
      "germinated",
    ]);
  });

  test("in the order its model declares them", () => {
    expect(
      resolveCountedClasses(SEED_CLASSES, ["germinated", "ungerminated"]),
    ).toEqual(SEED_CLASSES);
  });

  test("never a class its model does not recognize", () => {
    expect(() => resolveCountedClasses(SEED_CLASSES, ["shoot"])).toThrow(
      ClassInvalidError,
    );
  });
});
