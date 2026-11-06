import sharp from "sharp";

import { MAX_SOURCE_IMAGE_PIXELS } from "../../domain/images/canonical";
import {
  type DishAnalysis,
  type DishCircle,
  dishCoverage,
  dishThumbnail,
  type ImageCoverage,
} from "../../domain/images/coverage";
import { detectDish } from "./dish";
import { DISH_RECIPE_ID, type DishRequest } from "./dish-recipe";
import type { CanonicalImage } from "./ingest";
import { processImage } from "./processing";

/** Analyze canonical bytes once, independently of models, runs and regional assets. */
export function createImageAnalyzer(
  detector: (request: DishRequest) => Promise<DishCircle | null> = detectDish,
) {
  return (image: CanonicalImage): Promise<DishAnalysis | null> =>
    processImage(async () => {
      const { scale, width, height } = dishThumbnail(image);
      const source = sharp(image.bytes, {
        limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
      });
      const metadata = await source.metadata();
      if (
        metadata.width !== image.width ||
        metadata.height !== image.height ||
        metadata.channels !== 3
      )
        throw new Error("Image pixels do not match the canonical frame");
      const rgb = await source
        .resize(width, height, { kernel: "lanczos3" })
        .raw()
        .toBuffer();
      try {
        const detected = await detector({ pixels: rgb, width, height });
        const circle = detected && {
          x: detected.x / scale,
          y: detected.y / scale,
          radius: detected.radius / scale,
        };
        return {
          recipe: DISH_RECIPE_ID,
          circle: dishCoverage(image, circle)?.circle ?? null,
        };
      } catch (error) {
        console.error(
          "Dish analysis unavailable; retaining the image for analysis retry",
          { imageId: image.digest },
          error,
        );
        return null;
      }
    });
}

export const analyzeImage = createImageAnalyzer();

/**
 * The dish coverage an image's analysis supports right now, or why a dish
 * task falls back to the whole image: analysis still pending or from an
 * older recipe, no dish found, or a circle the image cannot hold.
 */
export interface DishCoverageResolution {
  coverage: ImageCoverage | null;
  fallback: "pending" | "obsolete" | "no-candidate" | "invalid-circle" | null;
}

export function resolveDishCoverage(image: {
  width: number;
  height: number;
  dishAnalysis: DishAnalysis | null;
}): DishCoverageResolution {
  const analysis = image.dishAnalysis;
  if (!analysis) return { coverage: null, fallback: "pending" };
  if (analysis.recipe !== DISH_RECIPE_ID)
    return { coverage: null, fallback: "obsolete" };
  if (!analysis.circle) return { coverage: null, fallback: "no-candidate" };
  const coverage = dishCoverage(image, analysis.circle);
  return { coverage, fallback: coverage ? null : "invalid-circle" };
}
