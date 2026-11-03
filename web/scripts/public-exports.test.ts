import { expect, test } from "bun:test";

import { unusedPublicExports } from "./public-exports";

test("service APIs count aliases and types, and retain namespace consumers", () => {
  const sources = new Map([
    [
      "src/server/models/public.ts",
      'export { readModel, deleteModel, type Model } from "./registry";',
    ],
    [
      "src/server/agent/models.ts",
      'import { readModel as read, type Model } from "../models/public";',
    ],
  ]);
  expect(unusedPublicExports(sources)).toEqual([
    "src/server/models/public.ts: unused public export deleteModel",
  ]);
  sources.set(
    "src/server/agent/models.ts",
    'import * as models from "../models/public";',
  );
  expect(unusedPublicExports(sources)).toEqual([]);
});

test("tests and server testing helpers cannot sustain a public service export", () => {
  const sources = new Map([
    ["src/server/models/public.ts", 'export { seed } from "./registry";'],
    ["src/server/models/registry.test.ts", 'import { seed } from "./public";'],
    ["src/server/models/registry.test.tsx", 'import { seed } from "./public";'],
    ["src/server/models/testing.ts", 'import { seed } from "./public";'],
    ["test/models.ts", 'import { seed } from "../src/server/models/public";'],
    [
      "src/server/testing/models.ts",
      'import { seed } from "../models/public";',
    ],
  ]);
  expect(unusedPublicExports(sources)).toEqual([
    "src/server/models/public.ts: unused public export seed",
  ]);
});
