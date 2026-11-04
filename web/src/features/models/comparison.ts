import type { CountAccuracy } from "../../domain/models/read-model";
import { formatDecimal, formatDecimalChange } from "../../ui/numbers";

/** Mean count error per image, all classes together. */
export function totalError(accuracy: CountAccuracy): number {
  return Object.values(accuracy.meanError).reduce(
    (sum, error) => sum + error,
    0,
  );
}

/** Mean count errors are written to two decimals, so a small gain still shows. */
const ERROR_DIGITS = 2;

export function formatError(error: number): string {
  return formatDecimal(error, ERROR_DIGITS);
}

/** A change in mean count error, signed. */
export function formatErrorChange(change: number): string {
  return formatDecimalChange(change, ERROR_DIGITS);
}

export type Movement = "better" | "worse" | "none";

/**
 * Which way a count error moves from one version to the next, judged on the
 * errors as written, so a move too small to show is none.
 */
export function movement(from: number, to: number): Movement {
  if (formatError(from) === formatError(to)) return "none";
  return to < from ? "better" : "worse";
}
