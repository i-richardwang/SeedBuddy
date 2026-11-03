import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("a disabled option of a checkbox group holds its state", () =>
  expectIsolatedRun(
    "test/kit.tsx",
    ["checkboxGroup"],
    "kit checkboxGroup behaves",
  ));
