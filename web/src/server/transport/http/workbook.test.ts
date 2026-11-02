import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";

import {
  blankCell,
  countCell,
  dateCell,
  decimalCell,
  ratioCell,
  textCell,
  type Workbook,
} from "../../../lib/spreadsheet/workbook";
import { workbookResponse } from "./workbook";

const WORKBOOK: Workbook = {
  sheets: [
    {
      name: "萌发试验",
      columns: [{ width: 14 }, { width: 10 }, { width: 10 }],
      rows: [
        [textCell("萌发", { strong: true, columns: 3 }), blankCell, blankCell],
        [
          dateCell({ year: 2026, month: 9, day: 1 }),
          countCell(15),
          countCell(12),
        ],
      ],
      stickyRows: 1,
      stickyColumns: 1,
    },
    {
      name: "汇总",
      columns: [{ width: 14 }, { width: 10 }, { width: 10 }],
      rows: [[textCell("CK"), decimalCell(13.5, 1), ratioCell(0.625)]],
      stickyRows: 0,
      stickyColumns: 0,
    },
  ],
};

/** The file as a spreadsheet reads it, rather than as bytes. */
async function written(filename: string): Promise<Record<string, string>> {
  const response = await workbookResponse(WORKBOOK, filename);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  return Object.fromEntries(
    Object.entries(files).map(([path, bytes]) => [path, strFromU8(bytes)]),
  );
}

function part(files: Record<string, string>, path: string): string {
  const content = files[path];
  if (content === undefined) throw new Error(`The file has no ${path}`);
  return content;
}

describe("the workbook a browser downloads", () => {
  test("is served as a spreadsheet, and never from a cache", async () => {
    const response = await workbookResponse(WORKBOOK, "trial.xlsx");
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("is saved under the name it was given", async () => {
    const response = await workbookResponse(WORKBOOK, "trial.xlsx");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="trial.xlsx"; filename*=UTF-8''trial.xlsx`,
    );
  });

  test("extended filenames encode punctuation according to RFC 8187", async () => {
    const filename = "O'Brien (萌发)*.xlsx";
    const response = await workbookResponse(WORKBOOK, filename);
    const header = response.headers.get("Content-Disposition")!;
    const encoded = header.split("filename*=UTF-8''")[1]!;
    expect(encoded).toBe("O%27Brien%20%28%E8%90%8C%E5%8F%91%29%2A.xlsx");
    expect(decodeURIComponent(encoded)).toBe(filename);
  });

  test("spells a name out of ASCII for whoever cannot read it", async () => {
    const response = await workbookResponse(WORKBOOK, "萌发试验.xlsx");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="____.xlsx"; ` +
        `filename*=UTF-8''%E8%90%8C%E5%8F%91%E8%AF%95%E9%AA%8C.xlsx`,
    );
  });
});

describe("what the spreadsheet holds", () => {
  test("a count is a number", async () => {
    const sheet = part(await written("trial.xlsx"), "xl/worksheets/sheet1.xml");
    expect(sheet).toContain("<v>15</v>");
    expect(sheet).toContain("<v>12</v>");
  });

  test("a day is the day a spreadsheet counts, wherever it is opened", async () => {
    const sheet = part(await written("trial.xlsx"), "xl/worksheets/sheet1.xml");
    expect(sheet).toContain("<v>46266</v>");
  });

  test("a heading covers the columns it names", async () => {
    const sheet = part(await written("trial.xlsx"), "xl/worksheets/sheet1.xml");
    expect(sheet).toContain(`ref="A1:C1"`);
  });

  test("holds the heading in view while the readings scroll", async () => {
    const sheet = part(await written("trial.xlsx"), "xl/worksheets/sheet1.xml");
    expect(sheet).toContain(`state="frozen"`);
  });

  test("reads each quantity in the units it is measured in", async () => {
    const styles = part(await written("trial.xlsx"), "xl/styles.xml");
    expect(styles).toContain(`formatCode="0"`);
    expect(styles).toContain(`formatCode="yyyy-mm-dd"`);
    expect(styles).toContain(`formatCode="0.0"`);
    expect(styles).toContain(`formatCode="0.0%"`);
  });

  test("every sheet is written, each under its name", async () => {
    const files = await written("trial.xlsx");
    expect(part(files, "xl/workbook.xml")).toContain(`name="萌发试验"`);
    expect(part(files, "xl/workbook.xml")).toContain(`name="汇总"`);
    const second = part(files, "xl/worksheets/sheet2.xml");
    expect(second).toContain("<v>13.5</v>");
    expect(second).toContain("<v>0.625</v>");
  });
});
