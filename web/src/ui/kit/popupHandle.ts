import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { prefersReducedMotion } from "./mediaQuery";
import { repopTiming } from "./motionToken";

/*
 * For a popup shared by several triggers through a Base UI handle. The
 * handle's typings leave out `store` and `subscribeStore`, which detached
 * triggers still rely on at runtime: the handle points at an inert store
 * until a Root attaches in an effect, so the store is read through a
 * subscription, not captured once.
 */

interface PopupStore {
  state: {
    activeTriggerElement?: Element | null;
    open?: boolean;
    popupElement?: HTMLElement | null;
    positionerElement?: HTMLElement | null;
  };
  useState: (key: string) => unknown;
}

interface PopupHandle {
  store: PopupStore;
  subscribeStore: (listener: () => void) => () => void;
}

export function usePopupHandleStore(handle: object): PopupStore {
  const typed = handle as PopupHandle;
  const subscribe = useCallback(
    (listener: () => void) => typed.subscribeStore(listener),
    [typed],
  );
  const get = useCallback(() => typed.store, [typed]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Gone from the document, or under an ancestor with `display: none`. */
function isLost(element: Element | null | undefined) {
  if (!element?.isConnected) return true;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return true;
  }
  return false;
}

/**
 * Calls `destroy` when the open popup's trigger leaves the document or is
 * hidden. It looks every frame while open, since a stylesheet can hide the
 * trigger without touching the DOM.
 */
export function useDestroyOnLostTrigger(
  store: PopupStore,
  destroy: () => void,
) {
  const open = Boolean(store.useState("open"));

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const look = () => {
      if (isLost(store.state.activeTriggerElement)) {
        destroy();
        return;
      }
      frame = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [destroy, open, store]);
}

const ORIGIN_THRESHOLD = 0.5;

/**
 * Marks the positioner `data-zero-origin` while it sits at the viewport's
 * corner, where it lands when it has no anchor, so its styles can hide it.
 */
export function useMarkPositionerAtOrigin(store: PopupStore) {
  const open = Boolean(store.useState("open"));
  const positioner = store.useState("positionerElement") as
    HTMLElement | null | undefined;

  useLayoutEffect(() => {
    const current = () => store.state.positionerElement ?? positioner;
    if (!open || !current()) return;

    let frame = 0;
    const look = () => {
      const node = current();
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const atOrigin =
        Math.abs(rect.left) <= ORIGIN_THRESHOLD &&
        Math.abs(rect.top) <= ORIGIN_THRESHOLD;
      if (atOrigin) node.dataset.zeroOrigin = "true";
      else delete node.dataset.zeroOrigin;
      frame = requestAnimationFrame(look);
    };
    look();
    return () => {
      cancelAnimationFrame(frame);
      const node = current();
      if (node) delete node.dataset.zeroOrigin;
    };
  }, [open, positioner, store]);
}

const FAR_SWITCH = 280;

const REPOP_KEYFRAMES: Keyframe[] = [
  { opacity: 0, scale: 0.97 },
  { opacity: 1, scale: 1 },
];

function centerOf(element: Element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Whether the popup just moved to a trigger more than 280px from the last.
 * A morph over that distance reads as a stray box crossing the page, so the
 * switch is made at once and the popup replays a short entrance at the new
 * trigger.
 */
export function useRepopOnFarSwitch(store: PopupStore, enabled: boolean) {
  const trigger =
    (store.useState("activeTriggerElement") as Element | null | undefined) ??
    null;
  const open = Boolean(store.useState("open"));
  const popup =
    (store.useState("popupElement") as HTMLElement | null | undefined) ?? null;

  const last = useRef<{
    center: { x: number; y: number } | null;
    element: Element | null;
  }>({ center: null, element: null });
  const [repop, setRepop] = useState(false);

  useLayoutEffect(() => {
    if (!open || !enabled) {
      last.current = { center: null, element: null };
      setRepop(false);
      return;
    }
    const previous = last.current;
    if (trigger === previous.element) return;

    const center = trigger ? centerOf(trigger) : null;
    const far = Boolean(
      previous.element &&
      previous.center &&
      center &&
      Math.hypot(center.x - previous.center.x, center.y - previous.center.y) >
        FAR_SWITCH,
    );
    last.current = { center, element: trigger };
    setRepop(far);

    if (far && popup && !prefersReducedMotion.matches()) {
      popup.animate?.(REPOP_KEYFRAMES, repopTiming());
    }
  }, [enabled, open, popup, trigger]);

  return repop;
}
