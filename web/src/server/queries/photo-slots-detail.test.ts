import { describe, expect, test } from "bun:test";

import { observedTwice } from "../testing/experiments";
import { photoSlotsDetail } from "./photo-slots-detail";

describe("a day's photograph slots", () => {
  test("hold every unit with the day it left, and the day's photographs", async () => {
    const { experiment, units, first } = await observedTwice("Slots");
    const slots = await photoSlotsDetail({
      experiment: experiment.id,
      observation: first.id,
    });
    expect(slots!.units.map(({ code, leftOn }) => [code, leftOn])).toEqual([
      ["A-1", null],
      ["A-2", null],
      ["A-3", null],
      ["B-1", null],
      ["B-2", "2026-08-08"],
    ]);
    expect([...slots!.taken].sort()).toEqual(
      ["A-1", "A-2", "B-1"].map((code) => units.get(code)!).sort(),
    );
    const fresh = await photoSlotsDetail({ experiment: experiment.id });
    expect(fresh!.taken).toEqual([]);
  });

  test("are nothing for an observation the experiment does not have", async () => {
    const { experiment } = await observedTwice("Slots unknown");
    expect(
      await photoSlotsDetail({
        experiment: experiment.id,
        observation: crypto.randomUUID(),
      }),
    ).toBeNull();
  });
});
