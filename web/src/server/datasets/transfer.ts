import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { DatasetImportError } from "../../domain/datasets/errors";
import {
  type DatasetManifest,
  datasetManifestSchema,
} from "../../domain/datasets/manifest";
import type { Dataset } from "../../domain/datasets/schema";
import { sameClasses } from "../../domain/models/classes";
import { lockImage, markImagesUnclear } from "../images/public";
import { transaction } from "../infra/db/client";
import { refusingUnique } from "../infra/db/errors";
import {
  annotations,
  datasetImages,
  datasets,
  images,
} from "../infra/db/schema";
import { readModel } from "../models/public";
import { readDatasetByName } from "./memberships";
import { listImageRecords } from "./records";

/**
 * A dataset leaves and enters the workbench as a manifest and the images it
 * names. The manifest carries what the workbench keeps for the dataset: the
 * memberships, the reviews recorded for its model, and which photographs a
 * person found unclear. Images travel by digest ahead of the manifest, so
 * importing it is one atomic step that either creates the whole dataset or
 * nothing.
 */

/**
 * The manifest of the dataset of this name: its images with their detection
 * and annotation documents. Workbenches know a dataset by name; its id stays
 * with the workbench that holds it.
 */
export async function readDatasetManifest(
  name: string,
): Promise<DatasetManifest | null> {
  const dataset = await readDatasetByName(name);
  return dataset ? datasetManifest(dataset) : null;
}

/** The manifest of a dataset already read. */
export async function datasetManifest(
  dataset: Dataset,
): Promise<DatasetManifest> {
  const model = await readModel(dataset.modelId);
  if (!model) throw new Error(`Unknown model: ${dataset.modelId}`);
  const records = await listImageRecords(dataset.id);
  return datasetManifestSchema.parse({
    schemaVersion: 1,
    dataset: dataset.name,
    model: { id: model.id, classes: model.classes },
    images: records.map(({ image, detection, annotation, unclear }) => ({
      digest: image.digest,
      width: image.width,
      height: image.height,
      filename: image.filename,
      bytes: image.bytes,
      split: image.split,
      detection,
      annotation,
      unclear,
    })),
  });
}

function listed(digests: string[]): string {
  return digests.join(", ");
}

/**
 * Creates the dataset a manifest describes. The workbench must know the
 * manifest's model with the same classes, must hold every image it names as
 * the bytes it describes, and must have no dataset of that name and no review
 * of those images for that model: a manifest adds to a workbench, never
 * changes what a reviewer decided here. For the same reason the manifest
 * only adds marks of unclear photographs and never clears one made here.
 * Detections in the manifest are what another workbench's versions found and
 * are not recorded.
 */
export async function importDataset(
  manifest: DatasetManifest,
): Promise<Dataset> {
  const addedAt = new Date();
  return transaction(async (tx) => {
    const model = await readModel(manifest.model.id, tx);
    if (!model) {
      throw new DatasetImportError(`Unknown model: ${manifest.model.id}`);
    }
    if (!sameClasses(model.classes, manifest.model.classes)) {
      throw new DatasetImportError(
        `Model ${model.id} has classes ${listed(model.classes)}, not ${listed(manifest.model.classes)}`,
      );
    }
    const dataset: Dataset = {
      id: randomUUID(),
      name: manifest.dataset,
      modelId: model.id,
    };
    await refusingUnique(
      "datasets_name",
      () =>
        new DatasetImportError(`Dataset ${manifest.dataset} already exists`),
      () => tx.insert(datasets).values({ ...dataset, createdAt: addedAt }),
    );
    const digests = manifest.images.map((image) => image.digest).sort();
    for (const digest of digests) await lockImage(digest, tx);
    const stored = new Map(
      digests.length === 0
        ? []
        : (
            await tx
              .select({
                digest: images.id,
                width: images.width,
                height: images.height,
                bytes: images.bytes,
              })
              .from(images)
              .where(inArray(images.id, digests))
          ).map((image) => [image.digest, image]),
    );
    const missing = digests.filter((digest) => !stored.has(digest));
    if (missing.length > 0) {
      throw new DatasetImportError(`Images are not stored: ${listed(missing)}`);
    }
    const mismatched = manifest.images.filter((image) => {
      const image_ = stored.get(image.digest)!;
      return (
        image_.width !== image.width ||
        image_.height !== image.height ||
        image_.bytes !== image.bytes
      );
    });
    if (mismatched.length > 0) {
      throw new DatasetImportError(
        `Images have other metadata here: ${listed(mismatched.map((image) => image.digest))}`,
      );
    }
    const reviewing = manifest.images.filter((image) => image.annotation);
    if (reviewing.length > 0) {
      const reviewed = await tx
        .select({ digest: annotations.imageId })
        .from(annotations)
        .where(eq(annotations.modelId, model.id))
        .then((rows) => new Set(rows.map((row) => row.digest)));
      const conflicting = reviewing.filter((image) =>
        reviewed.has(image.digest),
      );
      if (conflicting.length > 0) {
        throw new DatasetImportError(
          `Images are already reviewed for ${model.id}: ${listed(conflicting.map((image) => image.digest))}`,
        );
      }
    }
    if (manifest.images.length > 0) {
      await tx.insert(datasetImages).values(
        manifest.images.map((image) => ({
          datasetId: dataset.id,
          imageId: image.digest,
          filename: image.filename,
          split: image.split,
          addedAt,
        })),
      );
    }
    await markImagesUnclear(
      manifest.images
        .filter((image) => image.unclear)
        .map((image) => image.digest),
      tx,
    );
    if (reviewing.length > 0) {
      await tx.insert(annotations).values(
        reviewing.map((image) => ({
          imageId: image.digest,
          modelId: model.id,
          document: image.annotation!,
          updatedAt: addedAt,
        })),
      );
    }
    return dataset;
  });
}
