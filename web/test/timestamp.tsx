import assert from "node:assert/strict";

import { body, render, unmount } from "./dom";

const { Timestamp } = await import("../src/ui/Timestamp");
const { getLocale } = await import("../src/paraglide/runtime");
const value = "2026-08-31T00:00:00.000Z";
try {
  for (const zone of ["Asia/Shanghai", "America/New_York"]) {
    process.env.TZ = zone;
    await render(<Timestamp key={zone} value={value} />);
    const expected = new Intl.DateTimeFormat(getLocale(), {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
    }).format(new Date(value));
    assert.equal(body.querySelector("time")?.textContent, expected);
  }
  console.log("timestamp uses the reader's clock");
} finally {
  await unmount();
}
