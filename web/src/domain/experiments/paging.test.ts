import { describe, expect, test } from "bun:test";

import { unitPageHolding, unitPageShown } from "./paging";
import type { UnitPage } from "./read-model";

const asked = { treatment: "t", page: 3, pageSize: 20 };

function read(pages: number): UnitPage {
  return {
    rows: [],
    treatment: "t",
    total: pages * 20,
    page: 3,
    pageSize: 20,
    pages,
  };
}

describe("a page of units read", () => {
  test("gives way to every unit's first page where the treatment is gone", () => {
    expect(unitPageShown(asked, null)).toEqual({
      instead: { treatment: null, page: 1, pageSize: 20 },
    });
  });

  test("gives way to the last page where the one asked lies past it", () => {
    expect(unitPageShown(asked, read(2))).toEqual({
      instead: { ...asked, page: 2 },
    });
  });

  test("shows where it holds the page asked", () => {
    const page = read(3);
    expect(unitPageShown(asked, page)).toEqual({ page });
  });
});

test("a unit's page is the one its position falls on", () => {
  const at = (position: number) =>
    unitPageHolding({ treatment: "t", position }, 20);
  expect(at(1)).toEqual({ treatment: "t", page: 1, pageSize: 20 });
  expect(at(20).page).toBe(1);
  expect(at(21).page).toBe(2);
  expect(at(45).page).toBe(3);
});
