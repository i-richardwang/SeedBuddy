import type { ImageRectangle } from "../images/geometry";
import type { ImageSize } from "./schema";

export interface Point {
  x: number;
  y: number;
}

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];

/** Smallest box edge, in image pixels, that still counts as an instance. */
const MIN_BOX_SIZE = 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Two boxes cover exactly the same pixels. */
export function sameBox(a: ImageRectangle, b: ImageRectangle): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

/** Intersects a box with the image; returns null when nothing usable remains. */
export function clipToImage(
  box: ImageRectangle,
  image: ImageSize,
): ImageRectangle | null {
  const left = clamp(box.x, 0, image.width);
  const top = clamp(box.y, 0, image.height);
  const right = clamp(box.x + box.width, 0, image.width);
  const bottom = clamp(box.y + box.height, 0, image.height);
  const width = right - left;
  const height = bottom - top;
  if (width < MIN_BOX_SIZE || height < MIN_BOX_SIZE) {
    return null;
  }
  return { x: left, y: top, width, height };
}

/** Builds a box of the given side centered on a point, then clips it to the image. */
export function boxAround(
  center: Point,
  side: number,
  image: ImageSize,
): ImageRectangle | null {
  return clipToImage(
    {
      x: center.x - side / 2,
      y: center.y - side / 2,
      width: side,
      height: side,
    },
    image,
  );
}

/** Translates a box, keeping its size and holding it inside the image. */
export function moveBox(
  box: ImageRectangle,
  delta: Point,
  image: ImageSize,
): ImageRectangle {
  return {
    ...box,
    x: clamp(box.x + delta.x, 0, image.width - box.width),
    y: clamp(box.y + delta.y, 0, image.height - box.height),
  };
}

/** Drags one handle of a box by a delta; opposite edges stay fixed. */
export function resizeBox(
  box: ImageRectangle,
  handle: Handle,
  delta: Point,
  image: ImageSize,
): ImageRectangle {
  let left = box.x;
  let top = box.y;
  let right = box.x + box.width;
  let bottom = box.y + box.height;

  if (handle.includes("w")) {
    left = clamp(left + delta.x, 0, right - MIN_BOX_SIZE);
  }
  if (handle.includes("e")) {
    right = clamp(right + delta.x, left + MIN_BOX_SIZE, image.width);
  }
  if (handle.includes("n")) {
    top = clamp(top + delta.y, 0, bottom - MIN_BOX_SIZE);
  }
  if (handle.includes("s")) {
    bottom = clamp(bottom + delta.y, top + MIN_BOX_SIZE, image.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Positions of the eight resize handles in image pixels. */
export function handlePositions(box: ImageRectangle): Record<Handle, Point> {
  const midX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return {
    nw: { x: box.x, y: box.y },
    n: { x: midX, y: box.y },
    ne: { x: right, y: box.y },
    e: { x: right, y: midY },
    se: { x: right, y: bottom },
    s: { x: midX, y: bottom },
    sw: { x: box.x, y: bottom },
    w: { x: box.x, y: midY },
  };
}
