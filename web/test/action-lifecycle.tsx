import assert from "node:assert/strict";

import { act, useState } from "react";

import { body, button, press, render, unmount, waitFor } from "./dom";

const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
const { useAsyncAction } = await import("../src/ui/hooks/useAsyncAction");
const { useConfirmDestructive } = await import("../src/ui/confirmDestructive");
const { FormDialog } = await import("../src/ui/FormDialog");
const { Button } = await import("../src/ui/kit/Button");
const { ModalHost } = await import("../src/ui/kit/Modal");
const { Toaster, toast } = await import("../src/ui/kit/Toast");
const { m } = await import("../src/paraglide/messages");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let stored = 0;
let loads = 0;
let write = deferred();
let success = deferred();
let reload: ReturnType<typeof deferred> | undefined;
let failure: "write" | "success" | null = null;
let invalidate: false | undefined;
let completedSuccess = false;

async function save() {
  await write.promise;
  if (failure === "write") throw new Error("Write refused");
  return ++stored;
}

async function afterSave(value: number) {
  await success.promise;
  if (failure === "success") throw new Error("Completion refused");
  toast.success(`Saved ${value}`);
  completedSuccess = true;
}

const route = createRootRoute({
  loader: async () => {
    loads++;
    await reload?.promise;
    return stored;
  },
  component: Harness,
});
const router = createRouter({
  routeTree: route,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

function Harness() {
  const revision = route.useLoaderData();
  const action = useAsyncAction();
  const confirmDestructive = useConfirmDestructive();
  const [open, setOpen] = useState(false);
  return (
    <>
      <output>Revision {revision}</output>
      <Button loading={action.busy} onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Button
        onClick={() =>
          confirmDestructive({
            title: "Remove record?",
            confirmLabel: "Remove",
            onConfirm: async () => {
              await save();
            },
            onSuccess: () => afterSave(stored),
            invalidate,
          })
        }
      >
        Ask to remove
      </Button>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Edit record"
        okText="Save"
        formId="save"
        busy={action.busy}
      >
        <form
          id="save"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(save, "Save failed", {
              invalidate,
              onSuccess: async (value) => {
                await afterSave(value);
                setOpen(false);
              },
            });
          }}
        />
      </FormDialog>
      <ModalHost />
      <Toaster />
    </>
  );
}

const busy = (label: string) =>
  button(label)?.getAttribute("aria-busy") === "true";
const visibleRevision = () => body.querySelector("output")?.textContent;
const dialog = () => body.querySelector('.ui-modal-popup[role="dialog"]');
const toastText = () =>
  Array.from(body.querySelectorAll(".ui-toast-description")).map(
    (node) => node.textContent,
  );
async function clearToasts() {
  for (const close of Array.from(body.querySelectorAll(".ui-toast-close")))
    await press(close);
  await waitFor(() => toastText().length === 0, "toasts close");
}
async function resolve(gate: ReturnType<typeof deferred>) {
  await act(async () => {
    gate.resolve();
  });
}

await router.load();
await render(<RouterProvider router={router} />);
try {
  for (const kind of ["form", "confirmation"] as const) {
    const label = kind === "form" ? "Save" : "Remove";
    const open = async () => {
      await press(button(kind === "form" ? "Edit" : "Ask to remove"));
      await waitFor(() => button(label), "the dialog opens");
    };
    for (const stage of ["write", "success", null] as const) {
      write = deferred();
      success = deferred();
      completedSuccess = false;
      failure = stage;
      const before = visibleRevision();
      const loaded = loads;
      await open();
      await press(button(label));
      assert.ok(busy(label), "the command spins during the write");
      assert.equal(
        button(m.ui_cancel())?.getAttribute("aria-disabled"),
        "true",
      );
      await press(button(m.ui_cancel()));
      assert.ok(dialog(), "a busy dialog cannot close");
      await resolve(write);
      if (stage !== "write") {
        assert.ok(busy(label), "the command stays busy throughout onSuccess");
        assert.equal(loads, loaded, "reload waits for onSuccess");
        assert.equal(visibleRevision(), before);
        assert.equal(toastText().length, 0);
      }
      if (stage === null) reload = deferred();
      await resolve(success);
      if (stage !== null) {
        await waitFor(() => !busy(label), "failure makes retry available");
        assert.ok(dialog(), "failure keeps the dialog open");
        assert.deepEqual(toastText(), [
          stage === "write" ? "Write refused" : "Completion refused",
        ]);
        assert.equal(loads, loaded, "failure does not invalidate the route");
        assert.equal(visibleRevision(), before);
        await press(button(m.ui_cancel()));
      } else {
        await waitFor(
          () => loads > loaded,
          "success invalidates the route by default",
        );
        assert.ok(completedSuccess);
        assert.deepEqual(toastText(), [`Saved ${stored}`]);
        assert.equal(
          visibleRevision(),
          before,
          "the old route remains until the reload completes",
        );
        await resolve(reload!);
        reload = undefined;
        await waitFor(
          () => visibleRevision() === `Revision ${stored}`,
          "the route shows the write",
        );
      }
      await waitFor(() => !dialog(), "the dialog closes");
      await clearToasts();
    }
    invalidate = false;
    write = deferred();
    success = deferred();
    const loaded = loads;
    const before = visibleRevision();
    await open();
    await press(button(label));
    await resolve(write);
    await resolve(success);
    await waitFor(
      () => !dialog(),
      "success closes without invalidation when opted out",
    );
    assert.equal(loads, loaded);
    assert.equal(visibleRevision(), before);
    assert.deepEqual(toastText(), [`Saved ${stored}`]);
    await clearToasts();
    invalidate = undefined;
  }
  console.log("action completion preserves failure and success lifetimes");
} finally {
  await unmount();
}
