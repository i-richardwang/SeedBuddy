import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { experimentRequestSchema, treatmentRequestSchema } from "./schema";

const INOCULATED = "2026-08-01";

test("an experiment cannot be created without a design", async () => {
  expect(
    experimentRequestSchema.safeParse({
      name: "Undesigned",
      inoculatedOn: INOCULATED,
      treatments: [],
    }).success,
  ).toBeFalse();
  expect(
    experimentRequestSchema.safeParse({
      name: "Undesigned",
      inoculatedOn: INOCULATED,
      treatments: [
        { name: "CK", replicates: 1 },
        { name: "ck", replicates: 1 },
      ],
    }).success,
  ).toBeFalse();
  expect(
    treatmentRequestSchema.safeParse({
      experiment: randomUUID(),
      name: "CK",
      replicates: 0,
    }).success,
  ).toBeFalse();
});
