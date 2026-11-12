import { z } from "zod";

import recipe from "../../../../src/seedctl/image_geometry/dish-recipe.json";
import type { ImageFrame, ImageRectangle } from "./geometry";

export const dishRecipeSchema = z.strictObject({
  thumbnailLongEdge: z.number().int().positive(),
  sigma: z.number().positive(),
  dp: z.number().positive(),
  edgeThreshold: z.number().positive(),
  centerThreshold: z.number().positive(),
  minRadiusFraction: z.number().positive().max(0.5),
  maxRadiusFraction: z.number().positive().max(0.5),
  radiusPreference: z.number().nonnegative(),
  coverageMargin: z.number().nonnegative().max(1),
  radiusTolerancePixels: z.number().nonnegative(),
});
export const DISH_GEOMETRY = Object.freeze(dishRecipeSchema.parse(recipe));

export function dishThumbnail(frame: Pick<ImageFrame, "width" | "height">) {
  const scale = Math.min(
    1,
    DISH_GEOMETRY.thumbnailLongEdge / Math.max(frame.width, frame.height),
  );
  return {
    scale,
    width: Math.max(1, Math.round(frame.width * scale)),
    height: Math.max(1, Math.round(frame.height * scale)),
  };
}

export const dishCircleSchema = z.strictObject({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  radius: z.number().finite().positive(),
});
export type DishCircle = z.infer<typeof dishCircleSchema>;

/**
 * The dish a task is bounded to: the circle analysis found, kept with a
 * margin of its radius. AI annotation assigns only the regions it touches and
 * never clips their evidence; training and inference frame the pixels to the
 * square around it, clipped to the image. Frozen where it is used, so later
 * analysis never changes what a run, snapshot or task was given.
 */
export const imageCoverageSchema = z.strictObject({
  kind: z.literal("dish"),
  circle: dishCircleSchema,
  margin: z.number().finite().nonnegative().max(1),
});
export type ImageCoverage = z.infer<typeof imageCoverageSchema>;

export function dishCoverage(
  frame: Pick<ImageFrame, "width" | "height">,
  value: unknown,
): ImageCoverage | null {
  const parsed = dishCircleSchema.safeParse(value);
  if (!parsed.success) return null;
  const { x, y, radius } = parsed.data;
  const { scale, width, height } = dishThumbnail(frame);
  const short = Math.min(width, height);
  if (
    x >= frame.width ||
    y >= frame.height ||
    radius <
      (Math.floor(short * DISH_GEOMETRY.minRadiusFraction) -
        DISH_GEOMETRY.radiusTolerancePixels) /
        scale ||
    radius >
      (Math.floor(short * DISH_GEOMETRY.maxRadiusFraction) +
        DISH_GEOMETRY.radiusTolerancePixels) /
        scale
  )
    return null;
  return {
    kind: "dish",
    circle: parsed.data,
    margin: DISH_GEOMETRY.coverageMargin,
  };
}

/** Tangencies and all boundary tiles remain eligible. */
export function intersectsCoverage(
  rectangle: ImageRectangle,
  coverage: ImageCoverage | null,
): boolean {
  if (!coverage) return true;
  const { circle, margin } = coverage;
  const x = Math.max(
    rectangle.x,
    Math.min(circle.x, rectangle.x + rectangle.width),
  );
  const y = Math.max(
    rectangle.y,
    Math.min(circle.y, rectangle.y + rectangle.height),
  );
  return Math.hypot(x - circle.x, y - circle.y) <= circle.radius * (1 + margin);
}

/** Completed analysis with no candidate is distinct from unavailable analysis. */
export interface DishAnalysis {
  recipe: string;
  circle: DishCircle | null;
}
