import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("an empty table shows its empty state in place of the table", () =>
  expectIsolatedRun("test/kit.tsx", ["table"], "kit table behaves"));
