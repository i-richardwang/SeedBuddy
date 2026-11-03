import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("a pressed icon toggle says it is on, under the same name as off", () =>
  expectIsolatedRun("test/kit.tsx", ["actionIcon"], "kit actionIcon behaves"));
