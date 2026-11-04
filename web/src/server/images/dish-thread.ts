import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";

import type * as OpenCV from "@techstark/opencv-js";

import {
  type DishCircle,
  DISH_GEOMETRY as recipe,
} from "../../domain/images/coverage";
import type { DishRequest } from "./dish-recipe";

const port = parentPort;
if (!port) throw new Error("Dish analysis requires a compute thread");
const cv = createRequire(import.meta.url)(
  "@techstark/opencv-js",
) as typeof OpenCV & { then: (ready: () => void) => void };
// Emscripten's module is itself thenable: resolve readiness without assimilating it.
const ready = new Promise<void>((resolve) => cv.then(() => resolve()));

function detect({ pixels, width, height }: DishRequest): DishCircle | null {
  const source = new cv.Mat(height, width, cv.CV_8UC3);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const circles = new cv.Mat();
  try {
    source.data.set(pixels);
    cv.cvtColor(source, gray, cv.COLOR_RGB2GRAY);
    cv.GaussianBlur(
      gray,
      blurred,
      new cv.Size(0, 0),
      recipe.sigma,
      recipe.sigma,
      cv.BORDER_DEFAULT,
    );
    const short = Math.min(width, height);
    cv.HoughCircles(
      blurred,
      circles,
      cv.HOUGH_GRADIENT,
      recipe.dp,
      Math.floor(short / 2),
      recipe.edgeThreshold,
      recipe.centerThreshold,
      Math.floor(short * recipe.minRadiusFraction),
      Math.floor(short * recipe.maxRadiusFraction),
    );
    let best: DishCircle | null = null;
    let score = Infinity;
    for (let i = 0; i < circles.data32F.length; i += 3) {
      const x = circles.data32F[i]!,
        y = circles.data32F[i + 1]!,
        radius = circles.data32F[i + 2]!;
      const candidate =
        Math.hypot(x - width / 2, y - height / 2) -
        recipe.radiusPreference * radius;
      if (candidate < score) {
        best = { x, y, radius };
        score = candidate;
      }
    }
    return best;
  } finally {
    source.delete();
    gray.delete();
    blurred.delete();
    circles.delete();
  }
}

port.on("message", async (request: DishRequest) => {
  try {
    await ready;
    port.postMessage({ circle: detect(request) });
  } catch (error) {
    port.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
