import { describe, expect, test } from "bun:test";

import { identifierLabel } from "./schema";

describe("identifier labels", () => {
  test("read a generated identifier by its first eight digits", () => {
    expect(
      identifierLabel(
        "version-a1cf28ca5f4283747a96bcfa1ff4d87b5b14296faabccf7897bb952801b290a5",
      ),
    ).toBe("a1cf28ca");
    expect(identifierLabel("train-5e5b350e-b397-4c31-b27a-d70fbb40873c")).toBe(
      "5e5b350e",
    );
  });

  test("read a declared identifier whole", () => {
    expect(identifierLabel("traditional-v1")).toBe("traditional-v1");
    expect(identifierLabel("seed-detector")).toBe("seed-detector");
  });
});

test("bare image digests and generated identifiers share the label rule", () => {
  const digest = "0123456789abcdef".repeat(4);
  expect(identifierLabel(digest)).toBe("01234567");
  expect(identifierLabel(`image-${digest}`)).toBe(identifierLabel(digest));
  expect(identifierLabel("0123456789abcdef")).toBe("0123456789abcdef");
  expect(identifierLabel("seed-detector")).toBe("seed-detector");
});
