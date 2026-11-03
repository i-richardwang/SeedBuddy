import { z } from "zod";

import { resourceIdSchema } from "../identifiers/schema";
import { imageRectangleSchema } from "../images/geometry";
import { imageDigestSchema } from "../images/schema";
import { classNameSchema } from "../models/classes";

/**
 * An image is reviewed once a reviewer has stored boxes for it, and only
 * reviewed images train.
 */

/**
 * An annotation is addressed by the image and model it describes. The same
 * image annotated for two models has two documents; opening it from an
 * experiment or a dataset reaches the same document.
 *
 * The document is what a reviewer decided and nothing else. A review begins
 * from what one version of the model found and is independent of that
 * detection from then on: versions come and go, detections are recomputed,
 * and the annotation changes only when a person stores another review. That
 * independence is what lets a dataset carry its annotations to another
 * workbench unchanged.
 */
export const annotationRefSchema = z.strictObject({
  digest: imageDigestSchema,
  modelId: resourceIdSchema,
});

export type AnnotationRef = z.infer<typeof annotationRefSchema>;

/** Where an image's boxes can come from, best first. */
export const REVIEW_SOURCES = ["review", "proposal", "detection"] as const;

export type ReviewSource = (typeof REVIEW_SOURCES)[number];

/** One box a reviewer keeps, with the class the model's task defines. */
export const annotationInstanceSchema = z.strictObject({
  id: z.string().min(1),
  class: classNameSchema,
  bbox: imageRectangleSchema,
});

export const annotationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    image: z.strictObject({
      digest: imageDigestSchema,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    instances: z.array(annotationInstanceSchema),
  })
  .superRefine((document, context) => {
    const ids = new Set<string>();
    document.instances.forEach((instance, index) => {
      if (ids.has(instance.id)) {
        context.addIssue({
          code: "custom",
          path: ["instances", index, "id"],
          message: `Duplicate instance id: ${instance.id}`,
        });
      }
      ids.add(instance.id);
      const { x, y, width, height } = instance.bbox;
      if (
        x < 0 ||
        y < 0 ||
        x + width > document.image.width ||
        y + height > document.image.height
      ) {
        context.addIssue({
          code: "custom",
          path: ["instances", index, "bbox"],
          message: "Bounding box exceeds image bounds",
        });
      }
    });
  });

export type AnnotationInstance = z.infer<typeof annotationInstanceSchema>;
export type AnnotationDocument = z.infer<typeof annotationSchema>;
export type ImageSize = Pick<AnnotationDocument["image"], "width" | "height">;

export function newInstanceId(): string {
  return crypto.randomUUID();
}
