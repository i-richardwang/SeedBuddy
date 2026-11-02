import writeExcelFile, { type Cell } from "write-excel-file/node";

import type {
  Workbook,
  WorkbookCell,
  WorkbookSheet,
} from "../../../lib/spreadsheet/workbook";

const CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A count is whole. */
const COUNT_FORMAT = "0";
/** A day reads largest unit first, the order that sorts as it reads. */
const DATE_FORMAT = "yyyy-mm-dd";
/** A ratio reads as a percentage to one decimal. */
const RATIO_FORMAT = "0.0%";

/** A measured value reads to the decimals it was given. */
function decimalFormat(digits: number): string {
  return digits > 0 ? `0.${"0".repeat(digits)}` : "0";
}

/** A cell a heading covers is written by that heading, and left empty here. */
function encode(cell: WorkbookCell): Cell {
  const style = {
    fontWeight: cell.strong ? ("bold" as const) : undefined,
    columnSpan: cell.columns,
    rowSpan: cell.rows,
  };
  switch (cell.kind) {
    case "blank":
      return null;
    case "text":
      return { ...style, value: cell.text, type: String };
    case "date":
      return { ...style, value: cell.date, type: Date, format: DATE_FORMAT };
    case "count":
      return {
        ...style,
        value: cell.count,
        type: Number,
        format: COUNT_FORMAT,
        align: "right",
      };
    case "decimal":
      return {
        ...style,
        value: cell.value,
        type: Number,
        format: decimalFormat(cell.digits),
        align: "right",
      };
    case "ratio":
      return {
        ...style,
        value: cell.ratio,
        type: Number,
        format: RATIO_FORMAT,
        align: "right",
      };
  }
}

/** A sheet as the writer takes it: its name, its cells encoded, its widths and frozen panes. */
function sheet(item: WorkbookSheet) {
  return {
    sheet: item.name,
    data: item.rows.map((row) => row.map(encode)),
    columns: item.columns,
    stickyRowsCount: item.stickyRows,
    stickyColumnsCount: item.stickyColumns,
  };
}

/**
 * A name a browser saves the file under. The encoded form carries everything
 * outside ASCII, and the plain form is what a client without it reads.
 */
function attachment(filename: string): string {
  const plain = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

export async function workbookResponse(
  workbook: Workbook,
  filename: string,
): Promise<Response> {
  const file = await writeExcelFile(workbook.sheets.map(sheet)).toBuffer();
  // A Buffer is a window on a shared pool, so the response takes its own bytes.
  const bytes = new Uint8Array(file.byteLength);
  bytes.set(file);
  return new Response(bytes, {
    headers: {
      "Content-Type": CONTENT_TYPE,
      "Content-Disposition": attachment(filename),
      "Cache-Control": "no-store",
    },
  });
}
