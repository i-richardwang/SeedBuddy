import { canonicalJson } from "../../lib/json/canonical";
import type { AnnotationInstance, ReviewSource } from "./schema";

/** The boxes of a draft and the reading they descend from. */
interface DraftState {
  instances: AnnotationInstance[];
  origin: ReviewSource | null;
}

/** The unsaved edits to an image's annotation. */
export interface AnnotationDraft extends DraftState {
  base: AnnotationInstance[] | null;
  past: DraftState[];
  future: DraftState[];
  saving: boolean;
}

export type DraftAction =
  /** An edit: the boxes change, their lineage does not. */
  | { type: "replace"; instances: AnnotationInstance[] }
  /** Beginning again from one of the image's readings. */
  | { type: "restart"; instances: AnnotationInstance[]; origin: ReviewSource }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "submit" }
  | { type: "failed" };

/**
 * A draft begins from the boxes the page was showing and the reading they
 * came from; the stored review is kept apart as the base a save is checked
 * against. Undo and redo restore boxes and lineage together.
 */
export function openDraft(
  base: AnnotationInstance[] | null,
  start: DraftState,
): AnnotationDraft {
  return { ...start, base, past: [], future: [], saving: false };
}

function snapshot({ instances, origin }: DraftState): DraftState {
  return { instances, origin };
}

function commit(state: AnnotationDraft, next: DraftState): AnnotationDraft {
  if (canonicalJson(next) === canonicalJson(snapshot(state))) return state;
  return {
    ...state,
    ...next,
    past: [...state.past, snapshot(state)],
    future: [],
  };
}

/** Submission freezes the draft, including replacements already queued by gestures. */
export function reduceDraft(
  state: AnnotationDraft,
  action: DraftAction,
): AnnotationDraft {
  if (action.type === "failed") return { ...state, saving: false };
  if (state.saving) return state;
  switch (action.type) {
    case "submit":
      return { ...state, saving: true };
    case "replace":
      return commit(state, {
        instances: action.instances,
        origin: state.origin,
      });
    case "restart":
      return commit(state, {
        instances: action.instances,
        origin: action.origin,
      });
    case "undo": {
      const previous = state.past.at(-1);
      return previous
        ? {
            ...state,
            ...previous,
            past: state.past.slice(0, -1),
            future: [...state.future, snapshot(state)],
          }
        : state;
    }
    case "redo": {
      const next = state.future.at(-1);
      return next
        ? {
            ...state,
            ...next,
            past: [...state.past, snapshot(state)],
            future: state.future.slice(0, -1),
          }
        : state;
    }
  }
}
