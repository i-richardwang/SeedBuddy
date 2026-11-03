import { expect, test } from "bun:test";

import { bestEpoch } from "./metrics";
import type { TrainingEpoch } from "./schema";

function epoch(epoch: number, fitness: number): TrainingEpoch {
  return {
    epoch,
    recordedAt: "2026-08-28T00:00:00.000Z",
    train: { box: 1, classification: 1, regression: 1 },
    val: { box: 1, classification: 1, regression: 1 },
    precision: 0.5,
    recall: 0.5,
    map50: 0.5,
    map50To95: 0.25,
    fitness,
    learningRate: 0.001,
  };
}

test("best epoch follows Ultralytics fitness and keeps the first tie", () => {
  const first = epoch(1, 0.4);
  expect(bestEpoch([])).toBeNull();
  expect(bestEpoch([first, epoch(2, 0.8), epoch(3, 0.8)])?.epoch).toBe(2);
});
