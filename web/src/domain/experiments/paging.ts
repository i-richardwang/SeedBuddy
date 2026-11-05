import type { UnitNavigation, UnitPage, UnitPageRequest } from "./read-model";

/**
 * What a read of a page of units shows: the page, or, where it cannot show
 * the one asked, the page to show instead. Units of a treatment the
 * experiment no longer has, of which nothing was read, give way to every
 * unit, and a page past the last to the last.
 */
export function unitPageShown(
  asked: UnitPageRequest,
  read: UnitPage | null,
): { page: UnitPage } | { instead: UnitPageRequest } {
  if (read === null) {
    return { instead: { ...asked, treatment: null, page: 1 } };
  }
  return asked.page > read.pages
    ? { instead: { ...asked, page: read.pages } }
    : { page: read };
}

/**
 * The page of the units' table, `pageSize` units a page, that holds the unit
 * at `position` among the units stepped through: the treatment's, or every
 * unit.
 */
export function unitPageHolding(
  { treatment, position }: Pick<UnitNavigation, "treatment" | "position">,
  pageSize: number,
): UnitPageRequest {
  return { treatment, page: Math.ceil(position / pageSize), pageSize };
}
