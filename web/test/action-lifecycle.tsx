/** Isolated harness for write completion and the destructive confirmation boundary. */
import { render, unmount } from "./dom";

import assert from "node:assert/strict";
import { mock, spyOn } from "bun:test";
import { act } from "react";

import {
  useAsyncAction,
  type AsyncAction,
} from "../src/ui/hooks/useAsyncAction";
import { toast } from "../src/ui/kit/Toast";

let action: AsyncAction;
function Action() {
  action = useAsyncAction();
  return null;
}
await render(<Action />);
const errors = spyOn(toast, "error").mockImplementation(() => {});
const events: string[] = [];
let finish: (value: number) => void;
let completion: Promise<unknown>;
await act(async () => {
  completion = action.run(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    "Save failed",
    {
      onSuccess: (value) => {
        events.push(`close ${value}`);
      },
      invalidate: async () => {
        events.push("invalidate");
      },
    },
  );
});
assert.equal(action!.busy, true);
assert.deepEqual([...events], []);
await act(async () => {
  finish!(7);
  await completion;
});
assert.equal(action!.busy, false);
assert.deepEqual([...events], ["close 7", "invalidate"]);
await act(async () => {
  const result = await action.run(
    async () => {
      throw new Error("refused");
    },
    "Save failed",
    {
      onSuccess: () => {
        events.push("unexpected close");
      },
      invalidate: async () => {
        events.push("unexpected invalidate");
      },
    },
  );
  assert.equal(result.ok, false);
});
assert.deepEqual([...events], ["close 7", "invalidate"]);
assert.equal(errors.mock.calls.length, 1);
assert.equal(action!.busy, false);

let confirm: () => Promise<void>;
mock.module("../src/ui/kit/Modal", () => ({
  confirmModal: (options: { onOk: () => Promise<void> }) => {
    confirm = options.onOk;
    return () => {};
  },
}));
const { confirmDestructive } = await import("../src/ui/confirmDestructive");
const refusal = new Error("not removed");
let fails = true;
confirmDestructive({
  title: "Remove record?",
  confirmLabel: "Remove",
  onConfirm: () => {
    if (fails) throw refusal;
    events.push("remove");
  },
  onSuccess: () => {
    events.push("toast");
  },
  invalidate: async () => {
    events.push("reload");
  },
});
await assert.rejects(confirm!(), (error) => error === refusal);
assert.equal(
  errors.mock.calls.length,
  2,
  "the confirmation reports one failure",
);
assert.deepEqual([...events], ["close 7", "invalidate"]);
fails = false;
await confirm!();
assert.deepEqual(
  [...events],
  ["close 7", "invalidate", "remove", "toast", "reload"],
);
errors.mockRestore();
await unmount();
console.log("action completion preserves failure and success lifetimes");
