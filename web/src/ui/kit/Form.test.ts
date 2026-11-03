import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("a form shows a server error under its field", () =>
  expectIsolatedRun("test/kit.tsx", ["form"], "kit form behaves"));

test("a collapsible group opens from its heading and shows its command while open", () =>
  expectIsolatedRun("test/kit.tsx", ["formGroup"], "kit formGroup behaves"));
