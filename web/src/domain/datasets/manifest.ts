import { z } from "zod";

import { annotationSchema } from "../annotation/schema";
import { detectionResultSchema } from "../detection/schema";
import { resourceIdSchema } from "../identifiers/schema";
import { MAX_IMAGE_BYTES } from "../images/canonical";
import { imageDigestSchema } from "../images/schema";
import { classListSchema } from "../models/classes";
import { IMAGE_SPLITS } from "../training/schema";
import { DatasetManifestTooLargeError } from "./errors";
import { datasetNameSchema } from "./schema";

/** Keeps one manifest practical to validate and apply in a single transaction. */
export const MAX_DATASET_IMAGES = 10_000;
export const MAX_DATASET_MANIFEST_BYTES = 16 * 1024 * 1024;

/**
 * A dataset as it travels between workbenches and data roots: the images by
 * digest, their membership, the reviews recorded for the model, and the
 * detection each image currently shows. Reviews, memberships and which
 * photographs a person found unclear are what an importing workbench keeps;
 * detections are what its own versions found and are carried for readers of
 * the manifest, never imported. An image that does not say is clear.
 */
const datasetManifestImageSchema = z
  .strictObject({
    digest: imageDigestSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    filename: z.string().min(1),
    bytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
    split: z.enum(IMAGE_SPLITS).nullable(),
    detection: detectionResultSchema.nullable(),
    annotation: annotationSchema.nullable(),
    unclear: z.boolean().default(false),
  })
  .superRefine((image, context) => {
    for (const [field, document] of [
      ["detection", image.detection],
      ["annotation", image.annotation],
    ] as const) {
      if (!document) continue;
      if (document.image.digest !== image.digest) {
        context.addIssue({
          code: "custom",
          path: [field, "image", "digest"],
          message: `${field} describes another image`,
        });
      }
      if (
        document.image.width !== image.width ||
        document.image.height !== image.height
      ) {
        context.addIssue({
          code: "custom",
          path: [field, "image"],
          message: `${field} dimensions differ from the image`,
        });
      }
    }
  });

export const datasetManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    dataset: datasetNameSchema,
    model: z.strictObject({
      id: resourceIdSchema,
      classes: classListSchema,
    }),
    images: z.array(datasetManifestImageSchema).max(MAX_DATASET_IMAGES),
  })
  .superRefine((dataset, context) => {
    const classes = new Set(dataset.model.classes);
    const digests = new Set<string>();
    dataset.images.forEach((image, imageIndex) => {
      if (digests.has(image.digest)) {
        context.addIssue({
          code: "custom",
          path: ["images", imageIndex, "digest"],
          message: `Duplicate image digest: ${image.digest}`,
        });
      }
      digests.add(image.digest);
      for (const field of ["detection", "annotation"] as const) {
        image[field]?.instances.forEach((instance, instanceIndex) => {
          if (classes.has(instance.class)) return;
          context.addIssue({
            code: "custom",
            path: [
              "images",
              imageIndex,
              field,
              "instances",
              instanceIndex,
              "class",
            ],
            message: `${field} uses unknown class ${instance.class}`,
          });
        });
      }
    });
  });

export type DatasetManifest = z.infer<typeof datasetManifestSchema>;

/** The single wire representation used by API responses and archives. */
export function encodeDatasetManifest(
  manifest: DatasetManifest,
): Uint8Array<ArrayBuffer> {
  const document = datasetManifestSchema.parse(manifest);
  const bytes = new TextEncoder().encode(`${JSON.stringify(document)}\n`);
  if (bytes.byteLength > MAX_DATASET_MANIFEST_BYTES) {
    throw new DatasetManifestTooLargeError(
      `Dataset manifest exceeds ${MAX_DATASET_MANIFEST_BYTES / (1024 * 1024)} MiB`,
    );
  }
  return bytes;
}
