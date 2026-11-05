import { describe, expect, test } from "bun:test";

import { pairInOrder, replicateCodes, suggestUnit } from "./naming";

describe("unit naming", () => {
  test("codes a treatment's replicates in one series", () => {
    expect(replicateCodes("T1", 3, [])).toEqual(["T1-1", "T1-2", "T1-3"]);
  });

  test("continues the series past the codes already used", () => {
    expect(replicateCodes("T1", 2, ["T1-1", "t1-3"])).toEqual(["T1-2", "T1-4"]);
  });
});

describe("suggesting a unit from an image filename", () => {
  const codes = ["CK-1", "T1-1", "T1-2"];

  test("recognizes a code regardless of filename separator", () => {
    expect(suggestUnit("T1-2.jpg", codes)).toBe("T1-2");
    expect(suggestUnit(" t1_2.JPG ", codes)).toBe("T1-2");
    expect(suggestUnit("IMG_0413_T1-2.jpg", codes)).toBe("T1-2");
  });

  test("leaves an unmatched filename to the operator", () => {
    expect(suggestUnit("IMG_0413.jpg", codes)).toBeNull();
    expect(suggestUnit(".jpg", codes)).toBeNull();
    expect(suggestUnit("T1-9.jpg", codes)).toBeNull();
  });

  test("pairs photographs with open units in shooting order", () => {
    const pairs = pairInOrder(
      [
        { id: 1, filename: "IMG_0010.JPG" },
        { id: 2, filename: "IMG_0002.jpg" },
        { id: 3, filename: "IMG_0003.jpg" },
      ],
      ["ck-1", "ck-2"],
    );
    expect([...pairs]).toEqual([
      [2, "ck-1"],
      [3, "ck-2"],
    ]);
  });
});
