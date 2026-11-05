import { z } from "zod";

import type { UnitPageRequest } from "../../domain/experiments/read-model";
import {
  DEFAULT_UNIT_PAGE_SIZE,
  UNIT_PAGE_SIZES,
} from "../../domain/experiments/schema";

/** A page of the units' table as an address names it: counted from 1, else the first. */
export const unitTablePageSchema = z.number().int().min(1).default(1).catch(1);

/** A page size as an address names it: one of those offered, else the default. */
export const unitTableSizeSchema = z
  .number()
  .refine((size) => UNIT_PAGE_SIZES.some((offered) => offered === size))
  .default(DEFAULT_UNIT_PAGE_SIZE)
  .catch(DEFAULT_UNIT_PAGE_SIZE);

/**
 * A page of the units' table as the experiment page's address names it: the
 * treatment it is narrowed to, the page, and how many units a page holds.
 */
export function unitTableSearch(units: UnitPageRequest) {
  return {
    treatment: units.treatment ?? undefined,
    page: units.page,
    size: units.pageSize,
  };
}
