import { describe, expect, test } from "bun:test";

import { identifierLabel, timestampSchema } from "./schema";

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

test("timestamps require an instant and accept UTC or an explicit offset", () => {
  for (const value of [
    new Date().toISOString(),
    "2026-11-03T12:34:56+08:00",
    "2026-11-03T12:34:56.123-05:00",
  ])
    expect(timestampSchema.parse(value)).toBe(value);
  for (const value of ["2026-11-03", "2026-11-03T12:34:56", "not a timestamp"])
    expect(timestampSchema.safeParse(value).success).toBe(false);
});
