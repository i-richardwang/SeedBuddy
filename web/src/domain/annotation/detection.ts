import type { DetectionResult } from "../detection/schema";
import type { ImageRectangle } from "../images/geometry";
import {
  type AnnotationInstance,
  type ImageSize,
  newInstanceId,
} from "./schema";

/**
 * Default square for a box the reviewer adds. The boxes already on the image
 * are the strongest size prior; an image-relative fallback covers an image
 * with none.
 */
export function initialBoxSide(
  instances: readonly { bbox: ImageRectangle }[],
  image: ImageSize,
): number {
  const sides = instances
    .map(({ bbox }) => Math.sqrt(bbox.width * bbox.height))
    .sort((left, right) => left - right);
  if (sides.length === 0) {
    return Math.min(image.width, image.height) * 0.0125;
  }
  const middle = Math.floor(sides.length / 2);
  return sides.length % 2 === 1
    ? sides[middle]
    : (sides[middle - 1] + sides[middle]) / 2;
}

export function instanceFromBox(
  className: string,
  bbox: ImageRectangle,
): AnnotationInstance {
  return { id: newInstanceId(), class: className, bbox };
}

/** Every box the detection found, as the boxes a review begins from. */
export function instancesFromDetection(
  result: DetectionResult,
): AnnotationInstance[] {
  return result.instances.map(({ id, class: className, bbox }) => ({
    id,
    class: className,
    bbox,
  }));
}
