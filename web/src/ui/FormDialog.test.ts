import { test } from "bun:test";

import { expectIsolatedRun } from "../../test/isolated";

const run = (scenario: string) =>
  expectIsolatedRun(
    "test/dialogs.tsx",
    [scenario],
    `dialog ${scenario} behaves`,
  );

test("every opening of a form dialog starts fresh", () => run("fresh"));
test("every opening of a dialog session starts fresh", () => run("session"));
test("a busy form dialog cannot be dismissed", () => run("busy"));
test("a busy dialog without a footer cannot be dismissed", () =>
  run("footerless"));
