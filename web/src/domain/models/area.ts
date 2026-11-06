import { z } from "zod";

/**
 * The part of a photograph a model's task is about. A `dish` task concerns
 * the culture dish and its rim: AI annotation looks only there, training
 * frames each image to it, and its trained versions read the same frame. An
 * `image` task concerns the whole photograph.
 */
export const MODEL_AREAS = ["image", "dish"] as const;
export const modelAreaSchema = z.enum(MODEL_AREAS);
export type ModelArea = z.infer<typeof modelAreaSchema>;
