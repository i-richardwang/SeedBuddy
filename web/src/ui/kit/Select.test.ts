import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("a select reports the chosen value", () =>
  expectIsolatedRun("test/kit.tsx", ["select"], "kit select behaves"));

test("a toolbar select participates in arrow navigation and still chooses options", () =>
  expectIsolatedRun(
    "test/kit.tsx",
    ["toolbarSelect"],
    "kit toolbarSelect behaves",
  ));
