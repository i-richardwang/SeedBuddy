import { expect, test } from "bun:test";

import {
  DEFAULT_TRAINING_PRESET_ID,
  resolveTrainingRecipe,
  TRAINING_PRESETS,
} from "./recipes";

test("presets resolve independent recipes with explicit accumulation settings", () => {
  const nano = resolveTrainingRecipe(DEFAULT_TRAINING_PRESET_ID, {});
  expect(nano.parameters.nbs).toBe(64);
  const small = resolveTrainingRecipe("yolo26s-whole-2048-v1", {});
  expect(small.baseModel.reference).toBe("yolo26s.pt");
  expect(small.parameters).toMatchObject({
    imgsz: 2048,
    batch: 1,
    nbs: 8,
    warmup_epochs: 0,
    patience: 0,
    epochs: 50,
  });
  small.parameters.batch = 2;
  expect(
    resolveTrainingRecipe("yolo26s-whole-2048-v1", {}).parameters.batch,
  ).toBe(1);
  expect(TRAINING_PRESETS.map((preset) => preset.id)).toHaveLength(2);
});

test("only supplied editable values override a preset", () => {
  const recipe = resolveTrainingRecipe("yolo26s-whole-2048-v1", {
    batch: 2,
    nbs: 16,
    warmup_epochs: 1,
    epochs: undefined,
  });
  expect(recipe.parameters).toMatchObject({
    batch: 2,
    nbs: 16,
    warmup_epochs: 1,
    epochs: 50,
    imgsz: 2048,
  });
  expect(() => resolveTrainingRecipe("unknown", {})).toThrow();
  for (const overrides of [
    { batch: 0 },
    { nbs: 0 },
    { nbs: 1.5 },
    { nbs: 1025 },
    { warmup_epochs: 11 },
    { optimizer: "auto" },
    { baseModel: {} },
    { runtime: {} },
  ]) {
    expect(() =>
      resolveTrainingRecipe("yolo26s-whole-2048-v1", overrides),
    ).toThrow();
  }
});

test("high-resolution recipes accept stride-aligned sizes up to 3072", () => {
  for (const imgsz of [2560, 3072]) {
    expect(
      resolveTrainingRecipe("yolo26s-whole-2048-v1", { imgsz }).parameters
        .imgsz,
    ).toBe(imgsz);
  }
  for (const imgsz of [2561, 3104]) {
    expect(() =>
      resolveTrainingRecipe("yolo26s-whole-2048-v1", { imgsz }),
    ).toThrow();
  }
});
