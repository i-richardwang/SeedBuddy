/**
 * A spreadsheet as data: what each cell holds and the weight it carries, with
 * no opinion about the file format that writes it out. Quantities stay
 * quantities and days stay days, so whatever reads the file can sort, chart
 * and compute on them.
 */

export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

type CellValue =
  | { readonly kind: "blank" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "date"; readonly date: Date }
  | { readonly kind: "count"; readonly count: number }
  | {
      readonly kind: "decimal";
      readonly value: number;
      readonly digits: number;
    }
  | { readonly kind: "ratio"; readonly ratio: number };

export interface CellStyle {
  readonly strong?: boolean;
  readonly columns?: number;
  readonly rows?: number;
}

export type WorkbookCell = CellValue & CellStyle;

export const blankCell: WorkbookCell = { kind: "blank" };

export function textCell(text: string, style: CellStyle = {}): WorkbookCell {
  return { kind: "text", text, ...style };
}

/**
 * A day, held as the day itself rather than the text of it. A spreadsheet
 * counts days from an epoch and keeps no hour to lose one to, so midnight UTC
 * names the same day wherever the file is opened.
 */
export function dateCell(
  { year, month, day }: CalendarDate,
  style: CellStyle = {},
): WorkbookCell {
  return {
    kind: "date",
    date: new Date(Date.UTC(year, month - 1, day)),
    ...style,
  };
}

export function countCell(count: number, style: CellStyle = {}): WorkbookCell {
  return { kind: "count", count, ...style };
}

/** A measured value shown to `digits` decimals, such as a mean. */
export function decimalCell(
  value: number,
  digits: number,
  style: CellStyle = {},
): WorkbookCell {
  return { kind: "decimal", value, digits, ...style };
}

/** A ratio where 1 is whole, shown as a percentage to one decimal. */
export function ratioCell(ratio: number, style: CellStyle = {}): WorkbookCell {
  return { kind: "ratio", ratio, ...style };
}

interface WorkbookColumn {
  readonly width: number;
}

export interface WorkbookSheet {
  name: string;
  columns: WorkbookColumn[];
  rows: WorkbookCell[][];
  stickyRows: number;
  stickyColumns: number;
}

/** A file of one or more sheets, the first on show when it opens. */
export interface Workbook {
  sheets: WorkbookSheet[];
}

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const RESERVED = /[\\/?*[\]:]/g;
const QUOTED_ENDS = /^'+|'+$/g;
const MAX_SHEET_NAME = 31;

/**
 * A sheet is named in at most 31 characters, without the punctuation a range
 * reference is written with, and not opening or closing on the quote that
 * would make the name one.
 */
export function sheetName(name: string, fallback: string): string {
  const spelled = tidy(name.replace(RESERVED, " ")).slice(0, MAX_SHEET_NAME);
  const written = tidy(spelled.replace(QUOTED_ENDS, ""));
  return written.length > 0 ? written : fallback;
}

const UNWRITABLE = /[\\/:*?"<>|\p{Cc}]/gu;
const EXTENSION = ".xlsx";

export function workbookFilename(name: string, fallback: string): string {
  const written = tidy(name.replace(UNWRITABLE, " "));
  return `${written.length > 0 ? written : fallback}${EXTENSION}`;
}
