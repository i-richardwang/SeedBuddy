import { describe, expect, test } from "bun:test";

import { observedTwice } from "../testing/experiments";
import { experimentRecordsDetail } from "./experiment-records-detail";
import { manualEntryDetail } from "./manual-entry-detail";

describe("entering a day's counts", () => {
  test("lists one treatment's units on the bench with what each reads", async () => {
    const { experiment, first, second } = await observedTwice("Entry");
    const records = await experimentRecordsDetail(experiment.id);
    const [a, b] = records!.treatments;
    const firstA = await manualEntryDetail({
      experiment: experiment.id,
      observation: first.id,
      treatment: a!.id,
    });
    expect(
      firstA!.map(({ unit, photographed, manual }) => [
        unit.code,
        photographed?.count ?? null,
        manual,
      ]),
    ).toEqual([
      ["A-1", 4, null],
      ["A-2", null, null],
      ["A-3", null, null],
    ]);
    const secondA = await manualEntryDetail({
      experiment: experiment.id,
      observation: second.id,
      treatment: a!.id,
    });
    // A-3 was counted by hand on the second day, two of every class.
    expect(
      secondA!.map(({ unit, manual }) => [unit.code, manual?.tally ?? null]),
    ).toEqual([
      ["A-1", null],
      ["A-2", null],
      [
        "A-3",
        Object.fromEntries(second.countedClasses.map((name) => [name, 2])),
      ],
    ]);
    // B-2 left the bench on the first day.
    const secondB = await manualEntryDetail({
      experiment: experiment.id,
      observation: second.id,
      treatment: b!.id,
    });
    expect(secondB!.map(({ unit }) => unit.code)).toEqual(["B-1"]);
  });

  test("is nothing for a treatment or observation the experiment does not have", async () => {
    const { experiment, first } = await observedTwice("Entry unknown");
    const [a] = (await experimentRecordsDetail(experiment.id))!.treatments;
    expect(
      await manualEntryDetail({
        experiment: experiment.id,
        observation: first.id,
        treatment: crypto.randomUUID(),
      }),
    ).toBeNull();
    expect(
      await manualEntryDetail({
        experiment: experiment.id,
        observation: crypto.randomUUID(),
        treatment: a!.id,
      }),
    ).toBeNull();
  });
});
