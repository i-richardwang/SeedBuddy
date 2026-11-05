import { describe, expect, test } from "bun:test";

import type {
  UnitPage,
  UnitPageRequest,
} from "../../domain/experiments/read-model";
import { recordsSummary } from "../../domain/experiments/summary";
import { updateUnit } from "../experiments/design";
import {
  createExperiment,
  INOCULATED,
  observedTwice,
  unitsOf,
} from "../testing/experiments";
import { experimentPage } from "./experiment-page";
import { experimentRecordsDetail } from "./experiment-records-detail";

const PAGE = { treatment: null, page: 1, pageSize: 50 };

type Read = Awaited<ReturnType<typeof experimentPage>>;

/** The page of the experiment as shown, where it shows the view asked. */
function shown(page: Read): Exclude<Read, null | { instead: unknown }> {
  if (!page || "instead" in page) throw new Error("No view shown");
  return page;
}

/** The page of units the experiment's page shows for the request, over the first page of every unit. */
async function unitsPage(
  experimentId: string,
  units: Partial<UnitPageRequest>,
): Promise<UnitPage> {
  const { view } = shown(
    await experimentPage(experimentId, {
      tab: "units",
      units: { ...PAGE, ...units },
    }),
  );
  if (view.tab !== "units") throw new Error("No page of units");
  return view.units;
}

describe("the experiment's page", () => {
  test("frames the design and every observation by their counts alone", async () => {
    const { experiment, first, second } = await observedTwice("Page frame");
    const page = await experimentPage(experiment.id, { tab: "treatments" });
    expect(shown(page).view).toEqual({ tab: "treatments" });
    const frame = shown(page).frame;
    expect(frame.treatments.map(({ name, units }) => [name, units])).toEqual([
      ["A", 3],
      ["B", 2],
    ]);
    expect(frame.hasRecords).toBe(true);
    // A-2 and B-1 wait for their reading; A-1 is read.
    expect(frame.progress).toEqual({ photographs: 3, waiting: 2 });
    const day = (id: string) =>
      frame.observations.find((observation) => observation.id === id);
    expect(day(first.id)).toMatchObject({
      photographed: 3,
      available: 5,
      vacant: 2,
    });
    // B-2 left the bench on the first day.
    expect(day(second.id)).toMatchObject({
      photographed: 0,
      available: 4,
      vacant: 4,
    });
  });

  test("reads a page of rows cut from the units in the experiment's order", async () => {
    const { experiment, units, first, second } =
      await observedTwice("Page rows");
    const rows = await unitsPage(experiment.id, { pageSize: 2, page: 2 });
    expect(rows).toMatchObject({ total: 5, page: 2, pageSize: 2, pages: 3 });
    expect(rows.rows.map(({ unit }) => unit.code)).toEqual(["A-3", "B-1"]);
    const [a3, b1] = rows.rows;
    expect(a3!.cells.map((cell) => cell.observation)).toEqual([
      first.id,
      second.id,
    ]);
    expect(a3!.cells[1]!.reading).toMatchObject({ source: "manual" });
    expect(b1!.cells[0]!.image).toMatchObject({ state: "pending" });

    const a1 = (await unitsPage(experiment.id, { pageSize: 2 })).rows[0]!;
    expect(a1.unit.id).toBe(units.get("A-1")!);
    expect(a1.cells[0]).toMatchObject({
      reading: { count: 4, source: "detection" },
      image: { state: "analyzed" },
    });
  });

  test("orders codes by their numbers across pages", async () => {
    const experiment = await createExperiment({
      name: "Page order",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "T1", replicates: 11 }],
    });
    const codes = async (page: number) =>
      (await unitsPage(experiment.id, { pageSize: 3, page })).rows.map(
        ({ unit }) => unit.code,
      );
    expect(await codes(1)).toEqual(["T1-1", "T1-2", "T1-3"]);
    expect(await codes(4)).toEqual(["T1-10", "T1-11"]);
  });

  test("cuts every unit onto one page even where codes order alike", async () => {
    const experiment = await createExperiment({
      name: "Page ties",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "T1", replicates: 3 }],
    });
    const units = await unitsOf(experiment.id);
    const [treatment] = (await experimentRecordsDetail(experiment.id))!
      .treatments;
    // `T1-01` and `T1-1` read as the same number.
    await updateUnit({
      experiment: experiment.id,
      unit: units.get("T1-2")!,
      code: "T1-01",
      treatment: treatment!.id,
    });
    const ids: string[] = [];
    for (const page of [1, 2, 3]) {
      const { rows } = await unitsPage(experiment.id, { pageSize: 1, page });
      ids.push(...rows.map(({ unit }) => unit.id));
    }
    // Codes that read alike fall to the units' ids, so the order is total.
    const tied = [units.get("T1-1")!, units.get("T1-2")!].sort();
    expect(ids).toEqual([...tied, units.get("T1-3")!]);
  });

  test("narrows to one treatment", async () => {
    const { experiment } = await observedTwice("Page narrowed");
    const records = await experimentRecordsDetail(experiment.id);
    const b = records!.treatments.find((item) => item.name === "B")!.id;
    const page = await unitsPage(experiment.id, {
      treatment: b,
      page: 2,
      pageSize: 1,
    });
    expect(page).toMatchObject({ treatment: b, total: 2, pages: 2 });
    expect(page.rows.map(({ unit }) => unit.code)).toEqual(["B-2"]);
  });

  test("shows every unit for a treatment the experiment does not have", async () => {
    const { experiment } = await observedTwice("Page gone");
    const page = await experimentPage(experiment.id, {
      tab: "units",
      units: { ...PAGE, page: 3, treatment: crypto.randomUUID() },
    });
    expect(page).toEqual({ instead: PAGE });
  });

  test("the summary tab holds the summary of every unit's records", async () => {
    const { experiment } = await observedTwice("Page summary");
    const page = await experimentPage(experiment.id, { tab: "summary" });
    const records = await experimentRecordsDetail(experiment.id);
    expect(shown(page).view).toEqual({
      tab: "summary",
      summary: recordsSummary(records!),
    });
  });

  test("is nothing for an unknown experiment", async () => {
    expect(
      await experimentPage(crypto.randomUUID(), { tab: "treatments" }),
    ).toBeNull();
  });
});
