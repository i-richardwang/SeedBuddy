import { useBlocker, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useReducer } from "react";

import {
  type AnnotationDraft,
  type DraftAction,
  openDraft,
  reduceDraft,
} from "../../domain/annotation/draft";
import { type Review, sourceInstances } from "../../domain/annotation/readings";
import type {
  AnnotationInstance,
  ReviewSource,
} from "../../domain/annotation/schema";
import { businessFailureSchema } from "../../domain/errors";
import type { Model } from "../../domain/models/schema";
import { updateAnnotation } from "../../functions/review";
import { canonicalJson } from "../../lib/json/canonical";
import { m } from "../../paraglide/messages";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { classForShortcut } from "./controls";
import { isOwnedKey } from "./keys";

/** The readings a draft opens from: which one is shown, and the stored review. */
interface Opening {
  /** Changes whenever a reading the draft could open from changes. */
  key: string;
  shown: ReviewSource | null;
  base: AnnotationInstance[] | null;
  instances: AnnotationInstance[];
}

interface SessionState {
  opening: Opening;
  draft: AnnotationDraft;
  panning: boolean;
  selectedId: string | null;
  activeClass: string;
  /** A save found the stored review changed since the draft's base was read. */
  conflicted: boolean;
}

type SessionAction =
  | { type: "open"; opening: Opening; activeClass: string }
  | { type: "show"; opening: Opening }
  | { type: "conflict" }
  | { type: "panning"; panning: boolean }
  | { type: "selectedId"; selectedId: string | null }
  | { type: "activeClass"; activeClass: string }
  /** Readings begin again only through `show`, which also clears the selection. */
  | Exclude<DraftAction, { type: "restart" }>;

function opened(opening: Opening, activeClass: string): SessionState {
  return {
    opening,
    draft: openDraft(opening.base, {
      instances: opening.instances,
      origin: opening.shown,
    }),
    panning: false,
    selectedId: null,
    activeClass,
    conflicted: false,
  };
}

function reduceSession(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case "open":
      return opened(action.opening, action.activeClass);
    case "show":
      // Showing another reading over unsaved edits begins again from it,
      // as an edit that Undo takes back.
      return {
        ...state,
        opening: action.opening,
        selectedId: null,
        draft: action.opening.shown
          ? reduceDraft(state.draft, {
              type: "restart",
              instances: action.opening.instances,
              origin: action.opening.shown,
            })
          : state.draft,
      };
    case "conflict":
      return {
        ...state,
        conflicted: true,
        draft: reduceDraft(state.draft, { type: "failed" }),
      };
    case "panning":
      return { ...state, panning: action.panning };
    case "selectedId":
      return { ...state, selectedId: action.selectedId };
    case "activeClass":
      return { ...state, activeClass: action.activeClass };
    default:
      return { ...state, draft: reduceDraft(state.draft, action) };
  }
}

/**
 * Where the boxes on view stand: edited and not yet confirmed, a person's
 * review, a Worker's reading awaiting one, or nothing read at all.
 */
export type Standing =
  "edited" | "reviewed" | Exclude<ReviewSource, "review"> | "unread";

export interface ImageSession {
  instances: AnnotationInstance[];
  /** The reading the draft descends from. */
  origin: ReviewSource | null;
  standing: Standing;
  saving: boolean;
  /** Stores the boxes on view as the image's review; true once stored. */
  confirm: () => Promise<boolean>;
  /** Drops the edits and shows the reading again. */
  discard: () => void;
  panning: boolean;
  selectedId: string | null;
  setSelectedId: (selectedId: string | null) => void;
  replaceInstances: (instances: AnnotationInstance[]) => void;
  history: { canUndo: boolean; canRedo: boolean };
  undo: () => void;
  redo: () => void;
  deleteSelected: () => void;
  /** The class the palette shows: the selected box's, or the one new boxes take. */
  boxClass: string;
  changeClass: (name: string) => void;
  activeClass: string;
  /**
   * Saving is refused until the edits are dropped and the readings read
   * again, from which the draft then opens.
   */
  conflict: { reload: () => void } | null;
}

function openingOf(review: Review, shown: ReviewSource | null): Opening {
  const base = sourceInstances(review, "review");
  const instances = (shown && sourceInstances(review, shown)) ?? [];
  return {
    key: canonicalJson({ shown, base, instances }),
    shown,
    base,
    instances,
  };
}

/**
 * The image's boxes as a draft, open from the moment the page shows them. It
 * begins from the reading on view and follows that reading while nothing has
 * been edited; once edited it holds, and a save is checked against the review
 * it began from. While `locked` the editing keys rest. Leaving with edits
 * asks first.
 */
export function useImageSession({
  review,
  shown,
  model,
  locked,
}: {
  review: Review;
  shown: ReviewSource | null;
  model: Model;
  locked: boolean;
}): ImageSession {
  const confirmDestructive = useConfirmDestructive();
  const opening = useMemo(() => openingOf(review, shown), [review, shown]);
  const [session, dispatch] = useReducer(reduceSession, null, () =>
    opened(opening, model.classes[0]!),
  );
  const { draft } = session;
  const dirty = draft.past.length > 0;
  if (opening.key !== session.opening.key && !draft.saving) {
    if (!dirty) {
      dispatch({
        type: "open",
        opening,
        activeClass: session.activeClass,
      });
    } else if (opening.shown !== session.opening.shown) {
      dispatch({ type: "show", opening });
    }
  }

  const router = useRouter();
  const instances = draft.instances;
  const saving = draft.saving;
  const shouldBlockLeave = useCallback(() => saving || dirty, [saving, dirty]);
  const blocker = useBlocker({
    shouldBlockFn: shouldBlockLeave,
    enableBeforeUnload: shouldBlockLeave,
    withResolver: true,
  });

  // A navigation waiting on unsaved changes asks whether to discard them:
  // dismissing the question stays, discarding leaves, and saving stays and
  // withdraws the question.
  useEffect(() => {
    if (blocker.status !== "blocked") return;
    if (saving) {
      blocker.reset();
      return;
    }
    return confirmDestructive({
      title: m.annotation_discard_confirm(),
      content: m.annotation_discard_description(),
      confirmLabel: m.annotation_discard(),
      onConfirm: blocker.proceed,
      onCancel: blocker.reset,
      invalidate: false,
    });
  }, [blocker, saving, confirmDestructive]);

  const selected =
    instances.find((instance) => instance.id === session.selectedId) ?? null;

  const replaceInstances = useCallback(
    (next: AnnotationInstance[]) =>
      dispatch({ type: "replace", instances: next }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const setPanning = useCallback(
    (panning: boolean) => dispatch({ type: "panning", panning }),
    [],
  );
  const setSelectedId = useCallback(
    (selectedId: string | null) => dispatch({ type: "selectedId", selectedId }),
    [],
  );

  const deleteSelected = useCallback(() => {
    if (!session.selectedId) return;
    replaceInstances(
      instances.filter((instance) => instance.id !== session.selectedId),
    );
    dispatch({ type: "selectedId", selectedId: null });
  }, [instances, session.selectedId, replaceInstances]);

  const changeClass = useCallback(
    (name: string) => {
      dispatch({ type: "activeClass", activeClass: name });
      if (!selected || selected.class === name) return;
      replaceInstances(
        instances.map((instance) =>
          instance.id === selected.id ? { ...instance, class: name } : instance,
        ),
      );
    },
    [instances, replaceInstances, selected],
  );

  const clearSelection = useCallback(
    () => dispatch({ type: "selectedId", selectedId: null }),
    [],
  );

  const { run: runSave } = useAsyncAction();
  const confirm = useCallback(async () => {
    if (draft.saving) return false;
    dispatch({ type: "submit" });
    const result = await runSave(
      () =>
        updateAnnotation({
          data: {
            ref: review.ref,
            base: draft.base,
            instances: draft.instances,
          },
        }).catch((error: unknown) => {
          const failure = businessFailureSchema.safeParse(error);
          if (failure.success && failure.data.code === "annotation_conflict")
            return { status: "conflict" } as const;
          throw error;
        }),
      m.annotation_save_failed(),
      {
        invalidate: false,
        onSuccess: async (value) => {
          if (value.status === "conflict") {
            dispatch({ type: "conflict" });
            return;
          }
          // The stored boxes are the review now. The readings on hand still predate
          // it, so the draft holds until fresh ones arrive.
          dispatch({
            type: "open",
            opening: {
              key: opening.key,
              shown: "review",
              base: draft.instances,
              instances: draft.instances,
            },
            activeClass: session.activeClass,
          });
          await router.invalidate();
        },
      },
    );
    if (!result.ok) {
      dispatch({ type: "failed" });
      return false;
    }
    return result.value.status !== "conflict";
  }, [draft, review.ref, router, runSave, opening.key, session.activeClass]);

  const discard = useCallback(
    () => dispatch({ type: "open", opening, activeClass: session.activeClass }),
    [opening, session.activeClass],
  );

  const { run: runReload } = useAsyncAction();
  const reload = useCallback(() => {
    discard();
    void runReload(() => router.invalidate(), m.annotation_reload_failed(), {
      invalidate: false,
    });
  }, [discard, runReload, router]);

  useShortcuts({
    enabled: !saving && !locked,
    onPanChange: setPanning,
    onEscape: clearSelection,
    onDelete: deleteSelected,
    onUndo: undo,
    onRedo: redo,
    classes: model.classes,
    onClassChange: changeClass,
  });

  const origin = draft.origin;
  return {
    instances,
    origin,
    standing: dirty ? "edited" : standingOf(origin),
    saving,
    confirm,
    discard,
    panning: session.panning,
    selectedId: session.selectedId,
    setSelectedId,
    replaceInstances,
    history: {
      canUndo: draft.past.length > 0,
      canRedo: draft.future.length > 0,
    },
    undo,
    redo,
    deleteSelected,
    boxClass: selected?.class ?? session.activeClass,
    changeClass,
    activeClass: session.activeClass,
    conflict: session.conflicted ? { reload } : null,
  };
}

function standingOf(origin: ReviewSource | null): Standing {
  if (origin === null) return "unread";
  return origin === "review" ? "reviewed" : origin;
}

function useShortcuts({
  enabled,
  onPanChange,
  onEscape,
  onDelete,
  onUndo,
  onRedo,
  classes,
  onClassChange,
}: {
  enabled: boolean;
  onPanChange: (panning: boolean) => void;
  onEscape: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  classes: readonly string[];
  onClassChange: (name: string) => void;
}) {
  useEffect(() => {
    if (!enabled) {
      onPanChange(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOwnedKey(event.target) || event.altKey) return;
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          (event.shiftKey ? onRedo : onUndo)();
        }
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        onPanChange(true);
        return;
      }
      if (event.key === "Escape") {
        onEscape();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onDelete();
        return;
      }
      const shortcutClass = classForShortcut(classes, event.key);
      if (shortcutClass) onClassChange(shortcutClass);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") onPanChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    enabled,
    onPanChange,
    onEscape,
    onDelete,
    onUndo,
    onRedo,
    classes,
    onClassChange,
  ]);
}
