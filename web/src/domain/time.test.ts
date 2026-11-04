import { expect, test } from "bun:test";

import { timestampSchema } from "./time";

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
