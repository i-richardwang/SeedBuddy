import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("a closed modal unmounts its children", () =>
  expectIsolatedRun("test/kit.tsx", ["modal"], "kit modal behaves"));
