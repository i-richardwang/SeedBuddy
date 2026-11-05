/**
 * Isolated harness for the experiment routes' loaders: the server answers each
 * loader as the scenario sets it, a module mock the process keeps to itself.
 * Where a loader sends the reader is read as the router builds it, through
 * the routes' search middlewares, from the address the reader is on.
 */
import assert from "node:assert/strict";

import { mock } from "bun:test";
import {
  createMemoryHistory,
  createRouter,
  isRedirect,
  type NavigateOptions,
} from "@tanstack/react-router";

let answer: unknown = null;
const functions = await import("../src/functions/experiments");
mock.module("../src/functions/experiments", () => ({
  ...functions,
  getExperimentPage: async () => answer,
  getUnitDetail: async () => answer,
}));

const { routeTree } = await import("../src/routeTree.gen");
const { Route: UnitRoute } =
  await import("../src/routes/_workbench/experiments.$experiment.$unit");
const { Route: ExperimentRoute } =
  await import("../src/routes/_workbench/experiments.$experiment.index");

/**
 * The address a route's loader sends the reader to from `href`, or nothing
 * where it shows the page. The loader reads `href` as the router does: its
 * search validated by the route, and the route's dependencies drawn from it.
 */
async function redirected(
  href: string,
  route: { options: object },
  params: Record<string, string>,
): Promise<string | null> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [href] }),
  });
  const { validateSearch, loaderDeps, loader } = route.options as {
    validateSearch: { parse: (search: unknown) => unknown };
    loaderDeps: (context: { search: unknown }) => unknown;
    loader: (context: { params: unknown; deps: unknown }) => Promise<unknown>;
  };
  const search = validateSearch.parse(router.state.location.search);
  try {
    await loader({ params, deps: loaderDeps({ search }) });
    return null;
  } catch (cause) {
    if (!isRedirect(cause)) throw cause;
    return router.buildLocation(cause.options as NavigateOptions).href;
  }
}

const EXPERIMENT_ID = "11111111-1111-4111-8111-111111111111";
const UNIT_ID = "22222222-2222-4222-8222-222222222222";
const TREATMENT_ID = "44444444-4444-4444-8444-444444444444";
const experiment = `/experiments/${EXPERIMENT_ID}`;
const unit = `${experiment}/${UNIT_ID}`;

// A page of units the experiment cannot show gives way to the nearest.
answer = { instead: { treatment: null, page: 2, pageSize: 20 } };
assert.equal(
  await redirected(
    `${experiment}?treatment=${TREATMENT_ID}&page=9&size=20`,
    ExperimentRoute,
    { experiment: EXPERIMENT_ID },
  ),
  `${experiment}?page=2&size=20`,
);

// A unit not of the treatment named steps through every unit instead,
// keeping the rest of its address.
answer = { instead: { treatment: null } };
assert.equal(
  await redirected(
    `${unit}?treatment=${TREATMENT_ID}&size=20&show=review`,
    UnitRoute,
    { experiment: EXPERIMENT_ID, unit: UNIT_ID },
  ),
  `${unit}?size=20&show=review`,
);

// The control: a unit the server shows stays where it is.
answer = { navigation: { treatment: TREATMENT_ID } };
assert.equal(
  await redirected(`${unit}?treatment=${TREATMENT_ID}`, UnitRoute, {
    experiment: EXPERIMENT_ID,
    unit: UNIT_ID,
  }),
  null,
);

console.log("experiment route loaders redirect");
