import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("a menu opens from its trigger and runs an item", () =>
  expectIsolatedRun(
    "test/kit.tsx",
    ["dropdownMenu"],
    "kit dropdownMenu behaves",
  ));
