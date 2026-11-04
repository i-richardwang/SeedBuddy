import { test } from "bun:test";

import { expectIsolatedRun } from "../../test/isolated";

test("revealing a secret defers refresh until dismissal", async () => {
  await expectIsolatedRun(
    "test/reveal-once.tsx",
    [],
    "reveal dismissal refreshes once across reopening and all close controls",
  );
});
