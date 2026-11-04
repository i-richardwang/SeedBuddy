import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("adjustments survive a preset switch, restore by group, and submit alone", () =>
  expectIsolatedRun("test/training.tsx", [], "training presets behave"));
