import type { AnnotationInstance } from "../annotation/schema";
import type { ImageRectangle, ImageRegion } from "../images/geometry";
import { type AnnotationDefinition, annotationContentSchema } from "./schema";
import { owns, type RegionProposal, regionBoxes, tiles } from "./tasks";

/** Overlap at which two regions' boxes are read as one object. */
const SAME_OBJECT_IOU = 0.5;

/**
 * How a region read an object, strongest first: a box kept from a region the
 * run did not redraw, a box whose center lies in the reading region's core,
 * a whole box in its halo, and a box its patch edge cut.
 */
const STANDINGS = ["retained", "owned", "context", "partial"] as const;
type Standing = (typeof STANDINGS)[number];

/** One reading of an object by one region of the image. */
interface Sighting {
  region: string;
  bbox: ImageRectangle;
  standing: Standing;
}

function iou(a: ImageRectangle, b: ImageRectangle): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  const shared = width * height;
  return shared / (a.width * a.height + b.width * b.height - shared);
}

/**
 * Groups the sightings that are one object: overlapping by at least
 * SAME_OBJECT_IOU, whatever class each region judged it, and at most one from
 * each region. Strongest overlaps join first; sightings within one region
 * always stay apart.
 */
function sameObjects<T extends Sighting>(sightings: T[]): T[][] {
  const pairs: [number, number, number][] = [];
  const order = sightings
    .map((_, index) => index)
    .sort((a, b) => sightings[a]!.bbox.x - sightings[b]!.bbox.x);
  let active: number[] = [];
  for (const current of order) {
    const b = sightings[current]!;
    active = active.filter((index) => {
      const a = sightings[index]!.bbox;
      return a.x + a.width > b.bbox.x;
    });
    for (const index of active) {
      const a = sightings[index]!;
      if (a.region === b.region) continue;
      const overlap = iou(a.bbox, b.bbox);
      if (overlap >= SAME_OBJECT_IOU)
        pairs.push([
          overlap,
          Math.min(index, current),
          Math.max(index, current),
        ]);
    }
    active.push(current);
  }
  pairs.sort((x, y) => y[0] - x[0] || x[1] - y[1] || x[2] - y[2]);
  const groups = sightings.map((_, index) => [index]);
  const group = sightings.map((_, index) => index);
  for (const [, a, b] of pairs) {
    const into = group[a]!,
      from = group[b]!;
    if (into === from) continue;
    const regions = new Set(groups[into]!.map((i) => sightings[i]!.region));
    if (groups[from]!.some((i) => regions.has(sightings[i]!.region))) continue;
    for (const index of groups[from]!) group[index] = into;
    groups[into]!.push(...groups[from]!);
    groups[from] = [];
  }
  return groups
    .filter((members) => members.length > 0)
    .map((members) => members.sort((a, b) => a - b))
    .sort((a, b) => a[0]! - b[0]!)
    .map((members) => members.map((i) => sightings[i]!));
}

/**
 * The strongest sighting of an object, the first region in grid order among
 * equals; none when a lone halo sighting went unconfirmed by the region that
 * owns its center. The object takes everything, class included, from it.
 */
function representative<T extends Sighting>(object: T[]): T | null {
  const rank = (s: T) => STANDINGS.indexOf(s.standing);
  const best = object.reduce((a, b) => (rank(b) < rank(a) ? b : a));
  const confirmed =
    object.length > 1 ||
    best.standing === "retained" ||
    best.standing === "owned";
  return confirmed ? best : null;
}

/**
 * The image as the run leaves it. Each region reads its core and the halo
 * around it, and the regions it did not redraw keep the boxes the run began
 * from. Neighbors that read one object near their shared edge yield one box,
 * so an object straddling a seam is neither doubled nor dropped.
 */
export function collectRegions(
  definition: AnnotationDefinition,
  tasks: { taskId: string; region: ImageRegion; response: RegionProposal }[],
) {
  const boxes: (Sighting & AnnotationInstance & { uncertain: boolean })[] = [];
  for (const { taskId, region, response } of tasks) {
    for (const { owned, cut, ...box } of regionBoxes(
      response,
      region,
      definition,
    ))
      boxes.push({
        ...box,
        id: `${taskId}/${box.id}`,
        region: region.id,
        standing: owned ? "owned" : cut ? "partial" : "context",
      });
  }
  const redrawn = new Set(tasks.map((task) => task.region.id));
  const inputUncertain = new Set(definition.inputUncertainIds);
  for (const tile of tiles(definition)) {
    if (redrawn.has(tile.id)) continue;
    const kept = { region: tile.id, standing: "retained" } as const;
    for (const item of definition.input ?? []) {
      if (owns(tile.core, item.bbox))
        boxes.push({
          ...item,
          ...kept,
          uncertain: inputUncertain.has(item.id),
        });
    }
  }
  const objects = sameObjects(boxes).flatMap(
    (object) => representative(object) ?? [],
  );
  return annotationContentSchema.parse({
    document: {
      schemaVersion: 1,
      image: definition.image,
      instances: objects.map(({ id, class: name, bbox }) => ({
        id,
        class: name,
        bbox,
      })),
    },
    uncertainIds: objects.filter((box) => box.uncertain).map((box) => box.id),
  });
}
