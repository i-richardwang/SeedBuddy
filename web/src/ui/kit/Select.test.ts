import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("a select reports the chosen value", () =>
  expectIsolatedRun("test/kit.tsx", ["select"], "kit select behaves"));
