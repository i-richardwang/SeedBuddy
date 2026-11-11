import { useEffect, useEffectEvent, useState } from "react";

/** Open popups (a Select's options, a menu, a dialog) own the keys typed in them. */
const KEY_OWNERS =
  "[role='listbox'], [role='menu'], [role='dialog'], [role='alertdialog']";

/** A key typed into text or an open popup belongs there, not to the image. */
export function isOwnedKey(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable ||
      target.closest(KEY_OWNERS) !== null)
  );
}

/** Controls that answer Enter and the arrow keys themselves while focused. */
const KEY_HANDLERS = "button, a[href], input, select, textarea, [role]";

/**
 * The single keys a workbench answers: Enter, the arrows and C, each bound
 * by the page to what it does there, unless a control holding focus answers
 * them itself.
 */
export function useWorkbenchKeys(
  bindings: Partial<Record<WorkbenchKey, () => unknown>>,
) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    if (
      event.target instanceof HTMLElement &&
      event.target.closest(KEY_HANDLERS)
    ) {
      return;
    }
    const action = bindings[event.key as WorkbenchKey];
    if (!action) return;
    event.preventDefault();
    action();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}

/**
 * Mod+S stores the page's work, or does nothing while there is none to
 * store; either way the browser's own saving of the page stays out of it.
 */
export function useSaveKey(save: (() => unknown) | undefined) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
      return;
    }
    if (event.key.toLowerCase() !== "s" || isOwnedKey(event.target)) return;
    event.preventDefault();
    if (!event.repeat) save?.();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}

/** The key held to see the photograph bare. */
export const PEEK_KEY = "h";

/**
 * True while H is held: whatever is drawn over the image steps aside so the
 * photograph shows bare, locked or not, and returns when the key is let go
 * or the window loses focus.
 */
export function usePeekKey(): boolean {
  const [peeking, setPeeking] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key.toLowerCase() !== PEEK_KEY || isOwnedKey(event.target)) {
        return;
      }
      event.preventDefault();
      setPeeking(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === PEEK_KEY) setPeeking(false);
    };
    const release = () => setPeeking(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
    };
  }, []);
  return peeking;
}

type WorkbenchKey =
  "Enter" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "c";
