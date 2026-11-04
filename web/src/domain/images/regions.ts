import { type ImageCoverage, intersectsCoverage } from "./coverage";
import type {
  ImageFrame,
  ImageRectangle,
  ImageRegion,
  ImageRegionLayout,
} from "./geometry";
/** Native image regions, with clipped halos and half-open ownership cores. */
export function imageRegions(
  { width, height }: ImageFrame,
  { coreSize, halo }: ImageRegionLayout,
  scope: readonly ImageRectangle[] | null = null,
  coverage: ImageCoverage | null = null,
): ImageRegion[] {
  const result: ImageRegion[] = [];
  for (let y = 0, row = 0; y < height; y += coreSize, row++) {
    for (let x = 0, col = 0; x < width; x += coreSize, col++) {
      const core = {
        x,
        y,
        width: Math.min(coreSize, width - x),
        height: Math.min(coreSize, height - y),
      };
      if (!intersectsCoverage(core, coverage)) continue;
      if (
        scope &&
        !scope.some(
          (box) =>
            core.x < box.x + box.width &&
            box.x < core.x + core.width &&
            core.y < box.y + box.height &&
            box.y < core.y + core.height,
        )
      )
        continue;
      const left = Math.max(0, x - halo),
        top = Math.max(0, y - halo);
      result.push({
        id: `tile-${String(row).padStart(3, "0")}-${String(col).padStart(3, "0")}`,
        core,
        patch: {
          x: left,
          y: top,
          width: Math.min(width, x + core.width + halo) - left,
          height: Math.min(height, y + core.height + halo) - top,
        },
      });
    }
  }
  return result;
}

export function imageOverview({ width, height }: ImageFrame) {
  const scale = Math.min(1, 1024 / Math.max(width, height));
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale,
  };
}
