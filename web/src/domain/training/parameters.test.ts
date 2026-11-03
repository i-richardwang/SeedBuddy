import { expect, test } from "bun:test";

import {
  PARAMETER_FIELDS,
  PARAMETER_GROUPS,
} from "../../features/training/parameter-fields";
import {
  effectiveOverrides,
  trainingOverridesSchema,
  trainingParametersSchema,
} from "./parameters";
import { YOLO26N_WHOLE_RECIPE, YOLO26S_WHOLE_RECIPE } from "./recipes";

test("editable fields accept preset values without exposing model identity", () => {
  const parameters = trainingParametersSchema.parse(
    YOLO26N_WHOLE_RECIPE.parameters,
  );
  const overrides = Object.fromEntries(
    Object.keys(trainingOverridesSchema.shape)
      .filter((key) => key in parameters)
      .map((key) => [key, parameters[key as keyof typeof parameters]]),
  );

  expect(Object.keys(overrides).sort()).toEqual(
    [
      "batch",
      "epochs",
      "imgsz",
      "lr0",
      "patience",
      "warmup_epochs",
      "nbs",
    ].sort(),
  );
  expect(trainingOverridesSchema.parse(overrides)).toEqual(overrides);
  expect(() => trainingOverridesSchema.parse(parameters)).toThrow(
    /unrecognized/i,
  );
  for (const field of PARAMETER_FIELDS) {
    const value = overrides[field.key];
    if (typeof value !== "number") continue;
    expect(value).toBeGreaterThanOrEqual(field.min);
    expect(value).toBeLessThanOrEqual(field.max);
    const steps = (value - field.min) / field.step;
    expect(steps).toBeCloseTo(Math.round(steps));
  }
});

test("every parameter belongs to exactly one group, and every editable one is offered", () => {
  const grouped: string[] = PARAMETER_GROUPS.flatMap(
    (group) => group.parameters,
  );
  expect([...grouped].sort()).toEqual(
    Object.keys(trainingParametersSchema.shape).sort(),
  );
  expect(Object.keys(trainingOverridesSchema.shape).sort()).toEqual(
    PARAMETER_FIELDS.map((field) => field.key).sort(),
  );
});

test("omitted accumulation settings retain runtime semantics without rewriting a recipe", () => {
  const { nbs: _, ...parameters } = YOLO26N_WHOLE_RECIPE.parameters;
  expect(trainingParametersSchema.parse(parameters)).toEqual(parameters);
});

test("adjustments carried to another preset drop those it already makes", () => {
  expect(
    effectiveOverrides(
      { batch: 1, epochs: 80, nbs: 8 },
      YOLO26S_WHOLE_RECIPE.parameters,
    ),
  ).toEqual({ epochs: 80 });
});
