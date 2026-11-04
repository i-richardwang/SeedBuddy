import type { Transition } from "motion/react";

import { prefersReducedMotion } from "./mediaQuery";

/*
 * Every motion-driven transition in the kit comes from here, declarative or
 * passed to `animate()`. Durations and curves come from the motion tokens in
 * `app.css`, and each transition is instant while the reader prefers reduced
 * motion, as the global rule in `app.css` makes CSS transitions. Each token is
 * read from the document once and kept, so calling these during render costs
 * no style recalculation. On the server, or before the stylesheet has
 * applied, a token reads empty, is not kept, and motion's default applies.
 */

type Easing = [number, number, number, number];

type DurationToken =
  | "--duration-base"
  | "--duration-slow"
  | "--duration-backdrop"
  | "--duration-drawer-enter"
  | "--duration-drawer-exit"
  | "--duration-modal-enter"
  | "--duration-modal-exit"
  | "--duration-panel-fold";

type EaseToken = "--ease-accelerate" | "--ease-fade" | "--ease-soft";

const tokens = new Map<string, string>();

function read(token: DurationToken | EaseToken): string {
  const kept = tokens.get(token);
  if (kept !== undefined) return kept;
  if (typeof document === "undefined") return "";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  if (value) tokens.set(token, value);
  return value;
}

/** A duration token in milliseconds, or undefined before styles apply. */
function durationMs(token: DurationToken): number | undefined {
  const ms = Number.parseFloat(read(token));
  return Number.isFinite(ms) ? ms : undefined;
}

/** Tokens are milliseconds; motion takes seconds. */
function seconds(token: DurationToken): number | undefined {
  const ms = durationMs(token);
  return ms === undefined ? undefined : ms / 1000;
}

function easeOf(token: EaseToken): Easing | undefined {
  const points = /^cubic-bezier\(([^)]+)\)$/
    .exec(read(token))?.[1]
    ?.split(",")
    .map(Number);
  return points?.length === 4 && points.every(Number.isFinite)
    ? (points as Easing)
    : undefined;
}

const INSTANT: Transition = { duration: 0 };

/** Read when an animation starts, so the current motion preference applies. */
const honor = (transition: Transition): Transition =>
  prefersReducedMotion.matches() ? INSTANT : transition;

const PANEL_DURATION = {
  drawer: { enter: "--duration-drawer-enter", exit: "--duration-drawer-exit" },
  modal: { enter: "--duration-modal-enter", exit: "--duration-modal-exit" },
} as const;

const PHASE_EASE = { enter: "--ease-soft", exit: "--ease-accelerate" } as const;

export const panelTransition = (
  component: keyof typeof PANEL_DURATION,
  phase: "enter" | "exit",
): Transition =>
  honor({
    duration: seconds(PANEL_DURATION[component][phase]),
    ease: easeOf(PHASE_EASE[phase]),
  });

/** Width animation of a draggable panel folding and unfolding. */
export const foldTransition = (): Transition =>
  honor({
    duration: seconds("--duration-panel-fold"),
    ease: easeOf("--ease-soft"),
  });

export const backdropTransition = (): Transition =>
  honor({
    duration: seconds("--duration-backdrop"),
    ease: easeOf("--ease-soft"),
  });

/** A component's own spring, such as a press or a switch thumb. */
export const springTransition = (spring: {
  damping: number;
  mass?: number;
  stiffness: number;
}): Transition => honor({ ...spring, type: "spring" });

/** A shared popup replaying its entrance at a trigger far from the last one. */
export const repopTiming = (): KeyframeAnimationOptions => ({
  duration: durationMs("--duration-slow"),
  easing: read("--ease-fade") || undefined,
});
