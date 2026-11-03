import { sha256Schema } from "../identifiers/schema";
import { imageRegions } from "../images/regions";
import type { ImageRegion } from "../images/geometry";
import { AnnotationRunConflictError } from "./errors";
import type { AnnotationContent, AnnotationDefinition } from "./schema";
import {
  annotationSchema,
  type AnnotationInstance,
  type BoundingBox,
} from "../annotation/schema";
import { z } from "zod";

const edge = z.number().min(0).max(1000);
const box = z
  .array(edge)
  .length(4)
  .refine(
    (edges) => edges[0]! < edges[2]! && edges[1]! < edges[3]!,
    "Box edges must be ordered",
  );
const regionProposalSchema = z.strictObject({
  instances: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(128),
        class: z.string().min(1).max(128),
        box_2d: box,
        uncertain: z.boolean().default(false),
      }),
    )
    .max(10000),
});
export type RegionProposal = z.infer<typeof regionProposalSchema>;
export type Region = ImageRegion;

/** The grid an image is cut into for a model, whatever a run redraws. */
export function tiles(definition: AnnotationDefinition): Region[] {
  return imageRegions(definition.image, definition.config);
}

/** The frozen coverage and optional redraw scope select unchanged grid tiles. */
export function regions(definition: AnnotationDefinition): Region[] {
  return imageRegions(
    definition.image,
    definition.config,
    definition.scope,
    definition.coverage,
  );
}

function sourceBox(edges: number[], patch: BoundingBox): BoundingBox {
  const [top, left, bottom, right] = edges as [number, number, number, number];
  const x = patch.x + (left * patch.width) / 1000;
  const y = patch.y + (top * patch.height) / 1000;
  // Derive extents from the same edges, including the exact source boundary.
  return {
    x,
    y,
    width: patch.x + (right * patch.width) / 1000 - x,
    height: patch.y + (bottom * patch.height) / 1000 - y,
  };
}
export function owns(core: BoundingBox, box: BoundingBox): boolean {
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  return (
    x >= core.x &&
    x < core.x + core.width &&
    y >= core.y &&
    y < core.y + core.height
  );
}
export function prepareProposal(
  value: unknown,
  region: Region,
  definition: AnnotationDefinition,
) {
  const response = regionProposalSchema.parse(value);
  return { response, content: projectProposal(response, region, definition) };
}

/** A box one region drew, in source pixels, and how the region saw it. */
export interface RegionBox extends AnnotationInstance {
  /** Its center lies in the region's core. */
  owned: boolean;
  /** It touches a patch edge inside the image, so the region saw only part of it. */
  cut: boolean;
  uncertain: boolean;
}

/** Every box a region drew, its halo context included. */
export function regionBoxes(
  proposal: RegionProposal,
  region: Region,
  definition: AnnotationDefinition,
): RegionBox[] {
  const ids = new Set<string>();
  const p = region.patch;
  return proposal.instances.map((item) => {
    if (ids.has(item.id))
      throw new AnnotationRunConflictError("Duplicate instance ID");
    ids.add(item.id);
    if (!definition.config.classes.includes(item.class))
      throw new AnnotationRunConflictError("Unknown annotation class");
    const bbox = sourceBox(item.box_2d, p);
    const owned = owns(region.core, bbox);
    const [top, left, bottom, right] = item.box_2d;
    const cut =
      (left === 0 && p.x > 0) ||
      (top === 0 && p.y > 0) ||
      (right === 1000 && p.x + p.width < definition.image.width) ||
      (bottom === 1000 && p.y + p.height < definition.image.height);
    if (owned && cut)
      throw new AnnotationRunConflictError(
        "Owned box touches an internal patch boundary; use a larger halo in a new run",
      );
    return {
      id: item.id,
      class: item.class,
      bbox,
      owned,
      cut,
      uncertain: item.uncertain,
    };
  });
}

/** What one region saves on its own: the boxes its core owns. */
function projectProposal(
  proposal: RegionProposal,
  region: Region,
  definition: AnnotationDefinition,
): AnnotationContent {
  const boxes = regionBoxes(proposal, region, definition).filter(
    (box) => box.owned,
  );
  return {
    document: annotationSchema.parse({
      schemaVersion: 1,
      image: definition.image,
      instances: boxes.map(({ id, class: name, bbox }) => ({
        id,
        class: name,
        bbox,
      })),
    }),
    uncertainIds: boxes.filter((box) => box.uncertain).map((box) => box.id),
  };
}

export const annotationTaskInput = z.strictObject({
  taskId: z.string().min(1),
});
export const annotationPreviewInput = annotationTaskInput.extend(
  regionProposalSchema.shape,
);
export const annotationSubmitInput = annotationTaskInput.extend({
  proposalId: sha256Schema,
});
