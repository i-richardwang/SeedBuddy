/** Isolated DOM harness for the shared dialog entry; the scenario to run is the first argument. */

import assert from "node:assert/strict";

import { type ReactNode, useState } from "react";

import { m } from "../src/paraglide/messages";
import { body, button, press, pressKey, render, unmount, waitFor } from "./dom";

const { DialogSession, FormDialog } = await import("../src/ui/FormDialog");

/** A count the reader raises; it shows whether state survived a reopening. */
function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      {`${label} ${count}`}
    </button>
  );
}

const closed = () => button(m.ui_cancel()) === undefined;

/** Raises the counter once, closes the dialog and opens it again. */
async function reopenAfterRaising(
  dialog: (open: boolean) => ReactNode,
  label: string,
) {
  await render(dialog(true));
  await press(button(`${label} 0`));
  assert.ok(button(`${label} 1`), "the counter rises while open");
  await render(dialog(false));
  await waitFor(closed, "the closed dialog leaves");
  await render(dialog(true));
  assert.ok(button(`${label} 0`), "a reopened dialog starts fresh");
}

const scenarios: Record<string, () => Promise<void>> = {
  async fresh() {
    await reopenAfterRaising(
      (open) => (
        <FormDialog
          open={open}
          onClose={() => {}}
          title="Rename"
          okText="Save"
          formId="rename"
          busy={false}
        >
          <form id="rename">
            <Counter label="Typed" />
          </form>
        </FormDialog>
      ),
      "Typed",
    );
  },

  async session() {
    function Session({
      open,
      afterClose,
    }: {
      open: boolean;
      afterClose: () => void;
    }) {
      const [picked, setPicked] = useState(0);
      return (
        <FormDialog
          open={open}
          onClose={() => {}}
          afterClose={afterClose}
          title="Upload"
          okText={`Upload ${picked}`}
          formId="upload"
          busy={false}
        >
          <form id="upload">
            <button type="button" onClick={() => setPicked(picked + 1)}>
              Pick
            </button>
          </form>
        </FormDialog>
      );
    }
    const dialog = (open: boolean) => (
      <DialogSession open={open}>
        {(afterClose) => <Session open={open} afterClose={afterClose} />}
      </DialogSession>
    );
    await render(dialog(true));
    await press(button("Pick"));
    assert.ok(button("Upload 1"), "the footer reads the session's state");
    await render(dialog(false));
    await waitFor(closed, "the closed dialog leaves");
    await render(dialog(true));
    assert.ok(button("Upload 0"), "a reopened session starts fresh");
  },

  async busy() {
    let closes = 0;
    const dialog = (busy: boolean) => (
      <FormDialog
        open
        onClose={() => closes++}
        title="Rename"
        okText="Save"
        formId="rename"
        busy={busy}
      >
        <form id="rename">
          <input aria-label="Name" />
        </form>
      </FormDialog>
    );
    await render(dialog(true));
    await press(button(m.ui_cancel()));
    await pressKey("Escape");
    await press(body);
    assert.equal(closes, 0, "while busy, Cancel, Esc and the backdrop stay");
    await render(dialog(false));
    await press(button(m.ui_cancel()));
    await pressKey("Escape");
    await press(body);
    assert.equal(closes, 3, "once idle, Cancel, Esc and the backdrop close");
  },

  async footerless() {
    let closes = 0;
    const dialog = (busy: boolean) => (
      <FormDialog open onClose={() => closes++} title="Import" busy={busy}>
        <Counter label="Dropped" />
      </FormDialog>
    );
    await render(dialog(true));
    assert.ok(button("Dropped 0"), "the body shows");
    assert.equal(button(m.ui_cancel()), undefined, "there is no footer");
    await pressKey("Escape");
    await press(body);
    assert.equal(closes, 0, "while busy, Esc and the backdrop stay");
    await render(dialog(false));
    await pressKey("Escape");
    await press(body);
    assert.equal(closes, 2, "once idle, Esc and the backdrop close");
  },
};

const name = process.argv[2] ?? "";
const scenario = scenarios[name];
assert.ok(scenario, `unknown scenario ${name}`);
await scenario();
await unmount();
console.log(`dialog ${name} behaves`);
process.exit(0);
