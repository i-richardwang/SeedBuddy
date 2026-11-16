import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("observation forms cannot submit a batch still being loaded or checked", () =>
  expectIsolatedRun(
    "test/observation-photos.tsx",
    [],
    "batch submission is gated",
  ));
