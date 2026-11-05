import type {
  ManualReading,
  ManualReadingEntry,
} from "../../domain/experiments/schema";
import type { Tally } from "../../domain/models/classes";

/** What a person has typed for one unit: a number per class the day counts, or nothing yet. */
export type ManualReadingDraft = Record<string, number | null>;

/** A unit's draft as the form opens: the count it already has, where it has one. */
export function manualReadingDraft(
  classes: readonly string[],
  manual: ManualReading | null,
): ManualReadingDraft {
  return Object.fromEntries(
    classes.map((name) => [
      name,
      manual && Object.hasOwn(manual.tally, name) ? manual.tally[name] : null,
    ]),
  );
}

/**
 * The counts the drafts record, against what the day already holds: a unit
 * whose every class is filled in is counted, one left wholly empty withdraws
 * the count it had, and one unchanged is left alone. A unit filled in part
 * cannot be recorded, since a class left empty is not counted zero; such
 * units are named instead.
 */
export function manualReadingEntries(
  classes: readonly string[],
  drafts: ReadonlyMap<string, ManualReadingDraft>,
  existing: ReadonlyMap<string, ManualReading>,
): { entries: ManualReadingEntry[]; incomplete: string[] } {
  const entries: ManualReadingEntry[] = [];
  const incomplete: string[] = [];
  for (const [unit, draft] of drafts) {
    const filled = classes.filter((name) => draft[name] != null).length;
    const held = existing.get(unit);
    if (filled === 0) {
      if (held) entries.push({ unit, tally: null });
    } else if (filled < classes.length) {
      incomplete.push(unit);
    } else {
      const tally: Tally = { ...held?.tally };
      for (const name of classes) tally[name] = draft[name]!;
      if (!held || !sameTally(held.tally, tally)) entries.push({ unit, tally });
    }
  }
  return { entries, incomplete };
}

function sameTally(left: Tally, right: Tally): boolean {
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...names].every((name) => left[name] === right[name]);
}
