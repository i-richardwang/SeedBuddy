import { animate, type MotionValue, motionValue } from "motion/react";

import { foldTransition } from "./motionToken";

/*
 * Width state of a DraggablePanel, outside React. Two motion values drive
 * the panel: `size` is the visible width and `content` the width the
 * children are laid out at, so a fold clips the content instead of reflowing
 * it.
 */

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const emitter = () => {
  const listeners = new Set<() => void>();
  return {
    emit: () => {
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const isRtl = (element: Element | null) =>
  !!element && getComputedStyle(element).direction === "rtl";

let locks = 0;
let saved: Partial<CSSStyleDeclaration> = {};

/** Holds the resize cursor and blocks text selection while dragging; Esc cancels. */
const lockBody = (onEscape: () => void) => {
  const { style } = document.body;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape();
    }
  };

  if (locks === 0) {
    saved = {
      cursor: style.cursor,
      userSelect: style.userSelect,
      webkitUserSelect: style.webkitUserSelect,
    };
  }
  locks += 1;
  Object.assign(style, {
    cursor: "col-resize",
    userSelect: "none",
    webkitUserSelect: "none",
  });
  addEventListener("keydown", onKeyDown, true);

  return () => {
    locks -= 1;
    if (locks === 0) Object.assign(style, saved);
    removeEventListener("keydown", onKeyDown, true);
  };
};

const KEY_STEP = 10;
const KEY_STEP_FAST = 50;

const SCREEN_DELTA: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
};

export interface PanelControllerOptions {
  defaultSize: number;
  expand: boolean;
  max: number;
  min: number;
  onSizeChange: (size: number) => void;
  placement: "left" | "right";
  size: number;
}

interface PanelState {
  dragging: boolean;
  folding: boolean;
}

interface PanelKeyEvent {
  key: string;
  preventDefault: () => void;
  shiftKey: boolean;
}

interface PanelController {
  attach: (element: HTMLElement) => () => void;
  drag: {
    cancel: () => void;
    end: () => void;
    move: (offset: number) => void;
    start: () => void;
  };
  motion: { content: MotionValue<number>; size: MotionValue<number> };
  reset: () => void;
  resizeByKey: (event: PanelKeyEvent) => void;
  state: PanelState;
  subscribe: (listener: () => void) => () => void;
  sync: (options: PanelControllerOptions) => void;
  target: number;
}

export const createPanelController = (
  initial: PanelControllerOptions,
): PanelController => {
  const { emit: notify, subscribe } = emitter();

  let element: HTMLElement | null = null;
  let options = initial;
  let target = initial.expand ? initial.size : 0;
  let state: PanelState = { dragging: false, folding: false };
  let unlock: (() => void) | undefined;
  let foldTo = target;

  const size = motionValue(target);
  const content = motionValue(initial.size);

  const session = { max: 0, min: 0, sign: 1, start: 0 };

  const patch = (next: Partial<PanelState>) => {
    const entries = Object.entries(next) as [keyof PanelState, boolean][];
    if (entries.some(([key, value]) => state[key] !== value)) {
      state = { ...state, ...next };
      notify();
    }
  };

  /** A panel grows away from its side: one on the right leftward, mirrored in RTL. */
  const growSign = () =>
    (options.placement === "right" ? -1 : 1) * (isRtl(element) ? -1 : 1);

  const fold = (to: number) => {
    foldTo = to;
    patch({ folding: true });
    if (size.get() === 0) content.jump(to || content.get());
    else if (to > 0) animate(content, to, foldTransition());
    animate(size, to, foldTransition());
  };

  const release = () => {
    unlock?.();
    unlock = undefined;
  };

  const stopDragging = () => {
    release();
    patch({ dragging: false });
  };

  const drag = {
    cancel: () => {
      if (!state.dragging) return;
      size.jump(session.start);
      content.jump(session.start);
      stopDragging();
    },
    end: () => {
      if (!state.dragging) return;
      const committed = size.get();
      stopDragging();
      options.onSizeChange(committed);
    },
    move: (offset: number) => {
      if (!state.dragging) return;
      const pixels = session.start + offset * session.sign;
      const next = Math.round(clamp(pixels, session.min, session.max));
      size.jump(next);
      content.jump(next);
    },
    start: () => {
      Object.assign(session, {
        max: options.max,
        min: options.min,
        sign: growSign(),
        start: size.get(),
      });
      release();
      unlock = lockBody(drag.cancel);
      patch({ dragging: true, folding: false });
    },
  };

  const resizeByKey = (event: PanelKeyEvent) => {
    const { max, min } = options;
    const fast =
      event.shiftKey || event.key === "PageUp" || event.key === "PageDown";
    const step = (fast ? KEY_STEP_FAST : KEY_STEP) * growSign();
    const screen = SCREEN_DELTA[event.key];
    const moves: Record<string, number> = {
      End: max,
      Home: min,
      PageDown: target + step,
      PageUp: target - step,
    };
    const next =
      screen === undefined ? moves[event.key] : target + screen * step;
    if (next === undefined) return;

    event.preventDefault();
    const value = clamp(next, min, max);
    options.onSizeChange(value);
  };

  const sync = (next: PanelControllerOptions) => {
    options = next;
    const value = next.expand ? next.size : 0;
    if (size.get() === 0 && value > 0) content.jump(next.size);
    if (value !== target) {
      target = value;
      notify();
    }
    if (state.dragging) return;
    if (size.get() === target) {
      // A reversal can land back on the target before the outgoing animation
      // has moved; without this it keeps running past the new target.
      size.stop();
      content.stop();
      if (state.folding) {
        patch({ folding: false });
        content.jump(target || content.get());
      }
      foldTo = target;
    } else if (!state.folding || foldTo !== target) {
      fold(target);
    }
  };

  return {
    attach: (node) => {
      element = node;
      const stopSettle = size.on("animationComplete", () => {
        if (size.get() === target) patch({ folding: false });
      });
      return () => {
        stopSettle();
        release();
        element = null;
      };
    },
    drag,
    motion: { content, size },
    reset: () => options.onSizeChange(options.defaultSize),
    resizeByKey,
    get state() {
      return state;
    },
    subscribe,
    sync,
    get target() {
      return target;
    },
  };
};
