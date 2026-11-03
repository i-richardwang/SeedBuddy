import { expect, test } from "bun:test";
import type { z } from "zod";

import { Route as DatasetImageRoute } from "../../src/routes/_workbench/datasets.$dataset.$digest";
import { expectNotFound, type RouteLoader } from "./loader";

test("an image link names which reading to show", () => {
  const search = DatasetImageRoute.options.validateSearch as z.ZodType<{
    show?: "review" | "detection";
  }>;
  expect(search.parse({ show: "detection" })).toEqual({ show: "detection" });
  expect(search.parse({ show: "original" })).toEqual({ show: undefined });
  expect(search.parse({})).toEqual({ show: undefined });
});

test("the dataset image page rejects a malformed digest as not found", async () => {
  await expectNotFound(DatasetImageRoute.options.loader as RouteLoader, {
    dataset: "seed-set",
    digest: "not-a-digest",
  });
});
