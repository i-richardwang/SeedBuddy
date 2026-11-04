import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Timestamp } from "./Timestamp";

const VALUE = "2026-08-31T00:00:00.000Z";
test("the server writes an instant in UTC and names the zone", () => {
  const html = renderToStaticMarkup(<Timestamp value={VALUE} />);
  expect(html).toContain(`dateTime="${VALUE}"`);
  expect(html).toContain("UTC");
});
test("the browser reads instants on the reader's clock", async () => {
  const { expectIsolatedRun } = await import("../../test/isolated");
  await expectIsolatedRun(
    "test/timestamp.tsx",
    [],
    "timestamp uses the reader's clock",
  );
});
