import { expect, test } from "bun:test";

import { type DraftAction, openDraft, reduceDraft } from "./draft";
import type { AnnotationInstance, ReviewSource } from "./schema";

const from = (origin: ReviewSource, instances: AnnotationInstance[]) => ({
  instances,
  origin,
});

const box: AnnotationInstance = {
  id: "one",
  class: "seed",
  bbox: { x: 0, y: 0, width: 2, height: 3 },
};

const other: AnnotationInstance = {
  id: "two",
  class: "seed",
  bbox: { x: 1, y: 1, width: 2, height: 3 },
};

test("submission preserves one snapshot across queued replacements, undo and redo", () => {
  const initial = openDraft(null, from("review", []));
  const replaced = reduceDraft(initial, { type: "replace", instances: [box] });
  const saving = reduceDraft(replaced, { type: "submit" });
  for (const action of [
    { type: "replace", instances: [] },
    { type: "undo" },
    { type: "redo" },
    { type: "submit" },
  ] satisfies DraftAction[]) {
    expect(reduceDraft(saving, action)).toBe(saving);
  }
  expect(saving.base).toBeNull();
  expect(saving.instances).toEqual([box]);
  const retry = reduceDraft(saving, { type: "failed" });
  expect(retry.instances).toEqual([box]);
  expect(reduceDraft(retry, { type: "undo" }).instances).toEqual([]);
});

test("undo and redo change the draft without changing its save base", () => {
  const initial = openDraft([box], from("review", [box]));
  const replaced = reduceDraft(initial, { type: "replace", instances: [] });
  const undone = reduceDraft(replaced, { type: "undo" });
  expect(undone.instances).toEqual([box]);
  expect(undone.past).toEqual([]);
  expect(reduceDraft(undone, { type: "redo" }).instances).toEqual([]);
  expect(replaced.base).toEqual([box]);
  expect(
    reduceDraft(initial, { type: "replace", instances: [{ ...box }] }),
  ).toBe(initial);
});

test("the draft begins from the boxes shown; the fetched annotation is the save base", () => {
  const draft = openDraft([other], from("review", [box]));
  expect(draft.base).toEqual([other]);
  expect(draft.instances).toEqual([box]);
  expect(draft.past).toEqual([]);
  expect(draft.future).toEqual([]);
});

test("a first review has no base, and an empty saved review stays empty", () => {
  expect(openDraft(null, from("detection", [box])).base).toBeNull();
  expect(openDraft([], from("review", [])).instances).toEqual([]);
});

test("restarting from a reading changes the lineage; edits keep it; undo restores both", () => {
  const initial = openDraft([box], from("review", [box]));
  const restarted = reduceDraft(initial, {
    type: "restart",
    instances: [other],
    origin: "proposal",
  });
  expect(restarted.origin).toBe("proposal");
  const edited = reduceDraft(restarted, { type: "replace", instances: [] });
  expect(edited.origin).toBe("proposal");
  const undone = reduceDraft(reduceDraft(edited, { type: "undo" }), {
    type: "undo",
  });
  expect(undone).toMatchObject({ instances: [box], origin: "review" });
  expect(reduceDraft(undone, { type: "redo" }).origin).toBe("proposal");
});
