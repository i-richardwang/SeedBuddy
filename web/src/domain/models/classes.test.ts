import { describe, expect, test } from "bun:test";

import {
  assertInstanceClasses,
  classColor,
  classCount,
  classesAmong,
  classListSchema,
  countClasses,
  MAX_CLASSES,
  sameClasses,
  tally,
  tallySchema,
  unfoundClasses,
} from "./classes";

describe("tallies", () => {
  test("counts the instances of each class", () => {
    expect(
      tally([{ class: "seed" }, { class: "germinated" }, { class: "seed" }]),
    ).toEqual({ seed: 2, germinated: 1 });
  });

  test("counts the named classes a reading found, together", () => {
    const counts = { seed: 5, germinated: 15 };
    expect(countClasses(counts, ["seed", "germinated"])).toBe(20);
    expect(countClasses(counts, ["germinated"])).toBe(15);
  });

  test("counts nothing as nothing", () => {
    expect(countClasses({}, ["seed"])).toBe(0);
  });

  test("counts a class named for something every object carries", () => {
    const counts = tally([{ class: "constructor" }, { class: "constructor" }]);
    expect(counts).toEqual({ constructor: 2 });
    expect(classCount(counts, "constructor")).toBe(2);
    expect(countClasses(counts, ["constructor"])).toBe(2);
  });

  test("a class absent from a tally was counted zero times", () => {
    expect(classCount(tallySchema.parse({ seed: 3 }), "constructor")).toBe(0);
    expect(classCount(tallySchema.parse({ seed: 3 }), "germinated")).toBe(0);
  });

  test("class lists match name for name, in order", () => {
    expect(sameClasses(["seed", "germinated"], ["seed", "germinated"])).toBe(
      true,
    );
    expect(sameClasses(["seed", "germinated"], ["germinated", "seed"])).toBe(
      false,
    );
    expect(sameClasses(["seed"], ["seed", "germinated"])).toBe(false);
  });

  test("some classes are among a model's when it declares them all, in that order", () => {
    const declared = ["ungerminated", "germinated", "empty", "dead"];
    expect(classesAmong(declared, declared)).toBe(true);
    expect(classesAmong(["ungerminated", "germinated"], declared)).toBe(true);
    expect(classesAmong(["germinated", "dead"], declared)).toBe(true);
    expect(classesAmong(["germinated", "ungerminated"], declared)).toBe(false);
    expect(classesAmong(["germinated", "shoot"], declared)).toBe(false);
  });

  test("a version leaves unfound the classes its model declares beyond its own", () => {
    const declared = ["ungerminated", "germinated", "empty", "dead"];
    expect(unfoundClasses(declared, declared)).toEqual([]);
    expect(unfoundClasses(declared, ["ungerminated", "germinated"])).toEqual([
      "empty",
      "dead",
    ]);
    expect(unfoundClasses(declared, ["germinated"])).toEqual([
      "ungerminated",
      "empty",
      "dead",
    ]);
  });

  test("a model declares no more classes than can each be drawn in a color of its own", () => {
    const classes = Array.from(
      { length: MAX_CLASSES },
      (_, index) => `state_${index}`,
    );
    expect(classListSchema.safeParse(classes).success).toBe(true);
    expect(classListSchema.safeParse([...classes, "one_more"]).success).toBe(
      false,
    );
    const colors = classes.map((name) => classColor(classes, name));
    expect(new Set(colors.map((color) => color.hex)).size).toBe(MAX_CLASSES);
    expect(new Set(colors.map((color) => color.name)).size).toBe(MAX_CLASSES);
    expect(() => classColor(classes, "shoot")).toThrow(/not a class/);
  });

  test("rejects instances outside the model's task", () => {
    expect(() =>
      assertInstanceClasses(["seed"], [{ class: "mould" }], "Annotation"),
    ).toThrow(/unknown class: mould/);
  });
});
