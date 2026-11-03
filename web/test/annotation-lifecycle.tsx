/** Isolated DOM harness: real workbench, draft, viewport, controls and keys. */
import assert from "node:assert/strict";

import { mock } from "bun:test";
import { act, createElement, type ReactNode } from "react";

import { body, browser, button, render as renderNode, unmount } from "./dom";

Object.defineProperty(browser.HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get: () => 600,
});
Object.defineProperty(browser.HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get: () => 400,
});
/** Elements each resize observer watched, and those whose observer let go. */
const observations: unknown[] = [];
const disconnections: unknown[] = [];
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class {
    targets: unknown[] = [];
    observe(target: unknown) {
      this.targets.push(target);
      observations.push(target);
    }
    unobserve() {}
    disconnect() {
      disconnections.push(...this.targets);
    }
  },
});

function Passthrough({ children }: { children?: ReactNode }) {
  return createElement("div", null, children);
}
mock.module("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: async () => {} }),
  useBlocker: () => ({ status: "idle" }),
}));
mock.module("../src/ui/shell/Shell", () => ({
  ShellActions: Passthrough,
  ShellInspectorToggle: Passthrough,
  ShellTrail: ({ status }: { status?: ReactNode }) =>
    createElement("div", null, status),
  useInspectorFold: () => ({ collapsed: false, onCollapsedChange: () => {} }),
}));
let saved: { data: { base: unknown; instances: unknown } } | undefined;
let saves = 0;
/** What the next save answers once released. */
let saveStatus: "saved" | "conflict" = "saved";
let releaseSave: (() => void) | undefined;
mock.module("../src/functions/review", () => ({
  saveAnnotation: (request: typeof saved) => {
    saves++;
    saved = request;
    return new Promise((resolve) => {
      releaseSave = () => resolve({ status: saveStatus });
    });
  },
}));
mock.module("../src/functions/images", () => ({
  markUnclear: async () => {},
  clearUnclear: async () => {},
}));
const { ImageWorkbench } =
  await import("../src/features/annotation/ImageWorkbench");
const { SEED_DETECTOR } = await import("../src/domain/models/builtins");
const { m } = await import("../src/paraglide/messages");
const { classLabel } = await import("../src/ui/model-names");
const imageSize = { digest: "a".repeat(64), width: 1000, height: 800 };
const annotation = {
  schemaVersion: 1 as const,
  image: imageSize,
  instances: [
    {
      id: "box-1",
      class: "ungerminated",
      bbox: { x: 100, y: 100, width: 50, height: 50 },
    },
  ],
};
const proposal = {
  createdAt: "2026-09-14T00:00:00Z",
  document: {
    ...annotation,
    instances: [1, 2, 3].map((index) => ({
      ...annotation.instances[0]!,
      id: `ai-${index}`,
      bbox: { x: 100 * index, y: 100, width: 40, height: 40 },
    })),
  },
  uncertainIds: ["ai-2"],
};
const review = {
  ref: { digest: imageSize.digest, modelId: SEED_DETECTOR.id },
  filename: "seed.avif",
  width: imageSize.width,
  height: imageSize.height,
  detection: null,
  proposal,
  annotation,
  progress: null,
};
let source: "review" | "proposal" | "detection" | undefined;
let sourceChanges = 0;
let nexts = 0;
const render = ({
  onNext,
  counted,
}: { onNext?: () => void; counted?: string[] } = {}) =>
  renderNode(
    createElement(ImageWorkbench, {
      title: "Seed",
      model: SEED_DETECTOR,
      review,
      unclear: false,
      show: source,
      onShowChange(next) {
        sourceChanges++;
        source = next;
      },
      onNext,
      context: { counted },
    }),
  );
/** A busy button stays focusable and shows it is busy. */
const pending = (
  element: { getAttribute(name: string): string | null } | undefined,
) => element?.getAttribute("aria-busy") === "true";
/** Clicks a busy button and tells whether no further save started. */
const refuses = async (element: { click(): void } | undefined) => {
  const before = saves;
  await act(async () => element!.click());
  return saves === before;
};
const says = (text: string) => body.textContent?.includes(text) ?? false;
await render();
const image = body.querySelector("img")!;
const surface = image.parentElement! as import("happy-dom").HTMLElement;
const frame = surface.parentElement!;
const layer = surface.querySelector("svg")!;
browser.Element.prototype.setPointerCapture = () => {};
browser.Element.prototype.releasePointerCapture = () => {};
const boxes = () =>
  surface.querySelectorAll(
    "rect[vector-effect]:not([stroke-dasharray]):not([data-handle])",
  ).length;
const checks = () => surface.querySelectorAll("rect[stroke-dasharray]").length;
/** How often the viewport's frame was observed, and released, for resizing. */
const observed = () => observations.filter((target) => target === frame).length;
const disconnected = () =>
  disconnections.filter((target) => target === frame).length;
const pointer = async (
  target: { dispatchEvent(event: unknown): unknown },
  type: string,
  x: number,
  y: number,
) =>
  act(async () => {
    target.dispatchEvent(
      new browser.PointerEvent(type, {
        pointerId: 1,
        button: 0,
        clientX: x,
        clientY: y,
        bubbles: true,
      }),
    );
  });
/** Presses the image without dragging, where nothing is drawn. */
const tapEmpty = async () => {
  const empty = layer.querySelector("rect")!;
  await pointer(empty, "pointerdown", 450, 350);
  await pointer(empty, "pointerup", 450, 350);
};
const key = (init: Record<string, unknown>) =>
  act(async () => {
    browser.window.dispatchEvent(
      new browser.KeyboardEvent("keydown", { bubbles: true, ...init }),
    );
  });

assert.equal(boxes(), 1, "the reviewer's boxes outrank the agent's");
await tapEmpty();
assert.equal(boxes(), 1, "locked boxes take no edits");
const named = (label: string) =>
  browser.document.querySelector(`button[aria-label="${label}"]`);
await act(async () =>
  (named(m.annotation_unlock()) as unknown as { click(): void }).click(),
);
assert.ok(named(m.annotation_lock()), "the lock opens for editing");
assert.ok(says(m.annotation_standing_reviewed()), "a review reads as reviewed");
assert.equal(
  button(m.annotation_confirm()),
  undefined,
  "a review untouched has nothing to confirm",
);
await act(async () =>
  button(
    m.annotation_named_count({
      name: m.annotation_ai_section(),
      count: 3,
    }),
  )!.click(),
);
await render();
assert.equal(boxes(), 3, "the page can show the agent's reading instead");
assert.equal(
  checks(),
  1,
  "the agent's reading rings the box it asks to confirm",
);
assert.ok(says(m.annotation_standing_proposal()));
assert.ok(button(m.annotation_confirm()), "a proposal can be confirmed as is");
source = undefined;
await render();
assert.equal(boxes(), 1);
assert.equal(checks(), 0, "the review outranks the agent's proposal");

const countedOnly = m.annotation_counted_classes({
  classes: classLabel("germinated"),
});
assert.ok(!says(countedOnly), "an image counting every class names none");
await render({ counted: ["germinated"] });
assert.ok(says(countedOnly), "an image counting fewer classes names them");
assert.ok(
  button(
    m.annotation_named_count({
      name: m.annotation_ai_section(),
      count: 0,
    }),
  ),
  "each reading offers the sum over the classes its subject counts",
);
await render();

const initial = surface.style.transform;
await act(async () => {
  frame.dispatchEvent(
    Object.assign(
      new browser.MouseEvent("wheel", {
        clientX: 200,
        clientY: 120,
        bubbles: true,
      }),
      { deltaY: -300 },
    ),
  );
});
const zoomed = surface.style.transform;
assert.notEqual(zoomed, initial, "the wheel must establish a manual view");
frame.setPointerCapture = () => {};
frame.releasePointerCapture = () => {};
await pointer(frame, "pointerdown", 200, 120);
await pointer(frame, "pointermove", 140, 80);
await pointer(frame, "pointerup", 140, 80);
/** The view the person last chose, which editing must hold. */
const held = surface.style.transform;
assert.notEqual(held, zoomed, "the pointer must establish a manual pan");

await tapEmpty();
assert.equal(boxes(), 2, "pressing empty image adds a box");
assert.ok(says(m.annotation_standing_edited()), "an edit is unsaved");
assert.ok(button(m.annotation_discard_edits()));
assert.strictEqual(body.querySelector("img"), image);
assert.equal(surface.style.transform, held, "editing must hold the view");
await tapEmpty();
assert.equal(boxes(), 2, "pressing empty image first clears the selection");
await key({ key: "z", ctrlKey: true });
assert.equal(boxes(), 1, "Undo takes the box back");
assert.ok(says(m.annotation_standing_reviewed()), "undone edits leave none");

await tapEmpty();
source = "proposal";
await render();
assert.equal(boxes(), 3, "showing a reading over edits begins again from it");
assert.equal(checks(), 1, "a draft from the proposal keeps its checks");
await key({ key: "z", ctrlKey: true });
assert.equal(boxes(), 2, "Undo restores the edits before the reading");
assert.equal(checks(), 0, "Undo restores the draft's lineage with its boxes");

saveStatus = "conflict";
await act(async () => button(m.annotation_save())!.click());
assert.ok(pending(button(m.annotation_save())), "saving pends");
assert.ok(
  await refuses(button(m.annotation_save())),
  "a pending save refuses presses",
);
await act(async () => releaseSave?.());
const conflict = () =>
  Array.from(body.querySelectorAll('[role="status"]')).find((alert) =>
    alert.textContent?.includes(m.annotation_conflict()),
  );
assert.ok(conflict(), "a save conflict stays on the page");
assert.equal(
  button(m.annotation_save())?.getAttribute("aria-disabled"),
  "true",
  "a conflicted draft cannot be saved again",
);
assert.equal(boxes(), 2, "the draft survives the conflict");
await render();
assert.equal(boxes(), 2, "an edited draft holds while the page refreshes");
source = undefined;
await render();
await act(async () => button(m.annotation_reload())!.click());
assert.equal(conflict(), undefined, "reloading clears the conflict");
assert.equal(boxes(), 1, "the reloaded draft starts from the stored review");

saveStatus = "saved";
await tapEmpty();
const before = sourceChanges;
await act(async () => button(m.annotation_save())!.click());
await act(async () => releaseSave?.());
assert.deepEqual(saved?.data.base, annotation.instances);
assert.equal(
  (saved!.data.instances as unknown[]).length,
  2,
  "saving stores the boxes on view",
);
assert.equal(sourceChanges, before + 1, "saving returns to the best reading");
assert.equal(source, undefined);
assert.equal(boxes(), 2, "the saved boxes stay until fresh readings arrive");
assert.ok(says(m.annotation_standing_reviewed()));

await render({ onNext: () => nexts++ });
assert.ok(
  button(m.annotation_next_unreviewed()),
  "a reviewed image leads on to the next to review",
);
await key({ key: "Enter" });
assert.equal(nexts, 1, "Enter moves on");
await tapEmpty();
await key({ key: "s", ctrlKey: true });
assert.ok(pending(button(m.annotation_save())), "Mod+S saves");
await act(async () => releaseSave?.());
assert.equal(nexts, 1, "saving stays on the image");
assert.ok(
  button(m.annotation_next_unreviewed()),
  "a saved image leads on to the next to review",
);

assert.strictEqual(body.querySelector("img"), image);
assert.equal(surface.style.transform, held);
assert.equal(observed(), 1, "editing must not remount the viewport");
assert.equal(disconnected(), 0);
await unmount();
assert.equal(disconnected(), 1);
console.log("The image page retains one viewport");
