/**
 * A browser for isolated DOM harnesses. Importing it installs happy-dom's
 * globals, so it is imported before anything that renders; each harness runs
 * in its own process (see `isolated.ts`) because the globals are process-wide.
 */
import assert from "node:assert/strict";

import { type Element as DomElement, Window } from "happy-dom";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export const browser = new Window({ url: "http://localhost" });
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Image",
  "Element",
  "Node",
  "Event",
  "FocusEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "MutationObserver",
  "ResizeObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const) {
  const value = key === "window" ? browser : browser[key];
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
// Motion animates in JavaScript instead of through happy-dom's partial Web Animations.
delete (browser.Element.prototype as { animate?: unknown }).animate;
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

export const body = browser.document.body;
const mount = browser.document.createElement("div");
body.append(mount);
const root = createRoot(mount as unknown as HTMLElement);

export async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

export async function unmount() {
  await act(async () => root.unmount());
  await browser.happyDOM.close();
}

export const byRole = (role: string) =>
  Array.from(body.querySelectorAll(`[role="${role}"]`));

/** The button whose text is exactly `text`. */
export const button = (text: string) =>
  Array.from(body.querySelectorAll("button")).find(
    (element) => element.textContent === text,
  );

/** Presses an element the way a mouse does. */
export async function press(element: DomElement | null | undefined) {
  assert.ok(element, "the element to press exists");
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      element.dispatchEvent(
        new browser.PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    }
    (element as unknown as HTMLElement).click();
  });
}

/** Presses a key on the focused element, or on the document. */
export async function pressKey(key: string) {
  const target = browser.document.activeElement ?? browser.document;
  await act(async () => {
    target.dispatchEvent(
      new browser.KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
}

/**
 * Lets timers and animations run until `probe` holds, and returns what it
 * found; fails naming `what` after `timeout` milliseconds.
 */
export async function waitFor<T>(
  probe: () => T | null | undefined | false,
  what: string,
  timeout = 2000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const found = probe();
    if (found) return found;
    assert.ok(Date.now() < deadline, `timed out waiting until ${what}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}
