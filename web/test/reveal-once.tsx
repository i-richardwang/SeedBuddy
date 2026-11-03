import assert from "node:assert/strict";

import { useState } from "react";

import { body, button, press, pressKey, render, unmount, waitFor } from "./dom";

const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
const { RevealOnceDialog } = await import("../src/ui/RevealOnceDialog");
const { Button } = await import("../src/ui/kit/Button");
const { m } = await import("../src/paraglide/messages");
let loads = 0;
let closes = 0;
function Harness() {
  const [revealed, setRevealed] = useState<string | null>(null);
  return (
    <>
      <Button onClick={() => setRevealed("secret")}>Reveal</Button>
      <RevealOnceDialog
        revealed={revealed}
        title="New secret"
        hint="Keep it safe"
        onClose={() => {
          closes++;
          setRevealed(null);
        }}
      >
        {(value) => <output>{value}</output>}
      </RevealOnceDialog>
    </>
  );
}
const route = createRootRoute({ loader: () => ++loads, component: Harness });
const router = createRouter({
  routeTree: route,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
await router.load();
await render(<RouterProvider router={router} />);
try {
  for (const via of ["done", "close", "escape"] as const) {
    const before = loads;
    const closed = closes;
    await press(button("Reveal"));
    await waitFor(
      () => body.querySelector("output")?.textContent === "secret",
      "the secret is revealed",
    );
    assert.equal(loads, before, "revealing does not reload the route");
    if (via === "escape") {
      await pressKey("Escape");
    } else {
      const trigger =
        via === "done"
          ? button(m.ui_done())
          : body.querySelector(".ui-modal-close");
      assert.ok(trigger);
      await press(trigger);
    }
    await waitFor(
      () => closes === closed + 1 && loads === before + 1,
      "closing refreshes exactly once",
    );
    await waitFor(
      () => !body.querySelector(".ui-modal-popup"),
      "the reveal exits",
    );
    assert.equal(loads, before + 1);
  }
  console.log(
    "reveal dismissal refreshes once across reopening and all close controls",
  );
} finally {
  await unmount();
}
