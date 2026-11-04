import { DISH_GEOMETRY } from "../../domain/images/coverage";
import { documentDigest } from "../infra/digest";

const { coverageMargin: _coverageMargin, ...detection } = DISH_GEOMETRY;

/** Change the implementation revision when detection semantics change. */
const DISH_RECIPE = {
  ...detection,
  implementation: "opencv-hough-gradient/v1",
  interpolation: "sharp/lanczos3",
} as const;
export const DISH_RECIPE_ID = documentDigest(DISH_RECIPE);

export interface DishRequest {
  pixels: Uint8Array;
  width: number;
  height: number;
}
