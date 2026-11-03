import { z } from "zod";

import nanoManifest from "../../../../configs/yolo26/yolo26n-whole-v1.recipe.json";
import smallManifest from "../../../../configs/yolo26/yolo26s-whole-2048-v1.recipe.json";
import { trainingOverridesSchema } from "./parameters";
import { type TrainingRecipe, trainingRecipeSchema } from "./schema";

export const YOLO26N_WHOLE_RECIPE = trainingRecipeSchema.parse(nanoManifest);

export const YOLO26S_WHOLE_RECIPE = trainingRecipeSchema.parse(smallManifest);

/** Versioned templates. Runs carry a resolved copy of their selected recipe. */
export const TRAINING_PRESETS = [
  { id: "yolo26n-whole-v1", recipe: YOLO26N_WHOLE_RECIPE },
  {
    id: "yolo26s-whole-2048-v1",
    recipe: YOLO26S_WHOLE_RECIPE,
  },
] as const;

export type TrainingPreset = (typeof TRAINING_PRESETS)[number];
export type TrainingPresetId = TrainingPreset["id"];
export const DEFAULT_TRAINING_PRESET_ID: TrainingPresetId = "yolo26n-whole-v1";
export const trainingPresetIdSchema = z.enum(
  TRAINING_PRESETS.map((preset) => preset.id),
);

/** Resolve on the server; clients may only override the documented numeric fields. */
export function resolveTrainingRecipe(
  presetId: string,
  overrides: unknown,
): TrainingRecipe {
  const id = trainingPresetIdSchema.parse(presetId);
  const preset = TRAINING_PRESETS.find((candidate) => candidate.id === id)!;
  const changes = trainingOverridesSchema.parse(overrides);
  // Treat an explicit undefined like an omitted field, never erase a preset default.
  const defined = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  );
  return trainingRecipeSchema.parse({
    ...preset.recipe,
    parameters: { ...preset.recipe.parameters, ...defined },
  });
}
