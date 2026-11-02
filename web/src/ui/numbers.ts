import { getLocale } from "../paraglide/runtime";

/*
 * Every number on screen is written by the reader's locale: its digit
 * grouping, decimal mark and percent sign.
 */

function format(value: number, options: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

/** A count of things, whole. */
export function formatCount(value: number): string {
  return format(value, { maximumFractionDigits: 0 });
}

/** A measured value to a fixed number of decimals, such as a metric. */
export function formatDecimal(value: number, digits: number): string {
  return format(value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** A value entered or configured elsewhere, to every decimal it carries. */
export function formatNumber(value: number): string {
  return format(value, { maximumFractionDigits: 20 });
}

/** A ratio, where 1 is whole, as a percent without decimals. */
export function formatPercent(ratio: number): string {
  return format(ratio, { style: "percent", maximumFractionDigits: 0 });
}

/** A ratio, where 1 is whole, as a percent to one decimal, such as a rate. */
export function formatRate(ratio: number): string {
  return format(ratio, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** A change in a measured value, signed, to a fixed number of decimals. */
export function formatDecimalChange(value: number, digits: number): string {
  return format(value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: "exceptZero",
  });
}

/** A change in a count, whole and signed. */
export function formatCountChange(value: number): string {
  return format(value, {
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  });
}
