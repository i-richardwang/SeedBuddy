import { test } from "bun:test";

test("write completion only closes and reloads after success", async () => {
  const { expectIsolatedRun } = await import("../../../test/isolated");
  await expectIsolatedRun(
    "test/action-lifecycle.tsx",
    [],
    "action completion preserves failure and success lifetimes",
  );
});
