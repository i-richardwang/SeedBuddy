import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("resuming keeps saved progress unless told to start over", () =>
  expectIsolatedRun(
    "test/resume-training.tsx",
    [],
    "resuming training behaves",
  ));
