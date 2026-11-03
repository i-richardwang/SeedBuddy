import { expect, test } from "bun:test";
import type { z } from "zod";

import { Route as UnitRoute } from "../../src/routes/_workbench/experiments.$experiment.$unit";
import { Route as ExperimentRoute } from "../../src/routes/_workbench/experiments.$experiment.index";
import { expectNotFound, type RouteLoader } from "./loader";

const EXPERIMENT_ID = "11111111-1111-4111-8111-111111111111";
const OBSERVATION_ID = "33333333-3333-4333-8333-333333333333";
const UNIT_ID = "22222222-2222-4222-8222-222222222222";

test("experiment routes reject malformed resource identities as not found", async () => {
  await expectNotFound(ExperimentRoute.options.loader as RouteLoader, {
    experiment: "not-a-uuid",
  });
  await expectNotFound(UnitRoute.options.loader as RouteLoader, {
    experiment: "not-a-uuid",
    unit: UNIT_ID,
  });
  await expectNotFound(UnitRoute.options.loader as RouteLoader, {
    experiment: EXPERIMENT_ID,
    unit: "A1",
  });
});

test("an observation the link cannot name falls back to the newest", () => {
  const search = UnitRoute.options.validateSearch as z.ZodType<{
    observation?: string;
  }>;
  expect(search.parse({ observation: "not-a-uuid" })).toEqual({
    observation: undefined,
  });
  expect(search.parse({ observation: OBSERVATION_ID })).toEqual({
    observation: OBSERVATION_ID,
  });
});
