import { expect, test } from "bun:test";
import type { z } from "zod";

import { DEFAULT_UNIT_PAGE_SIZE } from "../../src/domain/experiments/schema";
import { Route as UnitRoute } from "../../src/routes/_workbench/experiments.$experiment.$unit";
import { Route as ExperimentRoute } from "../../src/routes/_workbench/experiments.$experiment.index";
import { expectIsolatedRun } from "../isolated";
import { expectNotFound, type RouteLoader } from "./loader";

const EXPERIMENT_ID = "11111111-1111-4111-8111-111111111111";
const OBSERVATION_ID = "33333333-3333-4333-8333-333333333333";
const UNIT_ID = "22222222-2222-4222-8222-222222222222";
const TREATMENT_ID = "44444444-4444-4444-8444-444444444444";

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
  expect(search.parse({ observation: "not-a-uuid" })).toMatchObject({
    observation: undefined,
  });
  expect(search.parse({ observation: OBSERVATION_ID })).toMatchObject({
    observation: OBSERVATION_ID,
  });
});

test("a unit keeps the size of the table's pages it was opened from", () => {
  const search = UnitRoute.options.validateSearch as z.ZodType<{
    size: number;
  }>;
  expect(search.parse({ size: 100 }).size).toBe(100);
  expect(search.parse({ size: 7 }).size).toBe(DEFAULT_UNIT_PAGE_SIZE);
  expect(search.parse({}).size).toBe(DEFAULT_UNIT_PAGE_SIZE);
});

test("an experiment's address it cannot read falls back to the defaults", () => {
  const search = ExperimentRoute.options.validateSearch as z.ZodType<{
    tab: string;
    page: number;
    size: number;
  }>;
  expect(search.parse({ tab: "summary", page: 3, size: 20 })).toMatchObject({
    tab: "summary",
    page: 3,
    size: 20,
  });
  expect(search.parse({ tab: "rows", page: 0, size: 7 })).toMatchObject({
    tab: "units",
    page: 1,
    size: DEFAULT_UNIT_PAGE_SIZE,
  });
});

test("loaders send an address they cannot show to the nearest they can", () =>
  expectIsolatedRun(
    "test/experiment-route-loaders.ts",
    [],
    "experiment route loaders redirect",
  ));

test("a unit's trail leads back to the page of the table that holds it", () => {
  const crumbs = UnitRoute.options.staticData!.crumbs!({
    loaderData: {
      experiment: { id: EXPERIMENT_ID, name: "Germination" },
      unit: { code: "T2-5" },
      navigation: { treatment: TREATMENT_ID, position: 45 },
    },
    params: {},
    search: { size: 20 },
  });
  expect(crumbs[1]!.href).toBe(
    `/experiments/${EXPERIMENT_ID}?treatment=${TREATMENT_ID}&page=3&size=20`,
  );
});
