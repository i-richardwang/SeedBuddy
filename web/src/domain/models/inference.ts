import { z } from "zod";

import type { ModelArea } from "./area";

/**
 * What a trained version is given to read: the whole canonical image, or
 * the dish the image's analysis found, framed with its margin. A version
 * reads the frame it was trained on, whatever its model's area is set to
 * since.
 */
export const inferenceModeSchema = z.enum(["whole_image", "dish"]);
export type InferenceMode = z.infer<typeof inferenceModeSchema>;

export const inferenceSettingsSchema = z.strictObject({
  confidence: z.number().finite().min(0).max(1),
  imageSize: z.number().int().positive(),
  maxDetections: z.number().int().positive(),
  endToEnd: z.boolean(),
  mode: inferenceModeSchema,
});

/** The frame a model's area trains, and so the mode its versions read in. */
export function inferenceModeForArea(area: ModelArea): InferenceMode {
  return area === "dish" ? "dish" : "whole_image";
}
