import { eq, inArray } from "drizzle-orm";

import {
  DatasetImportInvalidError,
  DatasetNameTakenError,
} from "../../domain/datasets/errors";
import type { DatasetManifest } from "../../domain/datasets/manifest";
import type { Dataset } from "../../domain/datasets/schema";
import { classesAmong } from "../../domain/models/classes";
import { insertImportedAnnotations } from "../annotations/public";
import { insertUnclearImages, lockImage } from "../images/public";
import {
  type Executor,
  inSnapshot,
  operationTime,
  snapshot,
  transaction,
} from "../infra/db/client";
import { annotations, datasetImages, images } from "../infra/db/schema";
import { requireModel } from "../models/public";
import { insertDataset, readDatasetByName } from "./datasets";
import { listImageRecords } from "./records";

/**
 * The manifest of the dataset of this name: its images with their detection
 * and annotation documents. Workbenches know a dataset by name; its id stays
 * with the workbench that holds it.
 */
export async function readDatasetManifest(
  name: string,
): Promise<DatasetManifest | null> {
  return snapshot(async (db) => {
    const dataset = await readDatasetByName(name, db);
    return dataset ? datasetManifest(dataset, db) : null;
  });
}

/** The manifest of a dataset already read. */
export async function datasetManifest(
  dataset: Dataset,
  db?: Executor,
): Promise<DatasetManifest> {
  return inSnapshot(db, async (db): Promise<DatasetManifest> => {
    const model = await requireModel(dataset.modelId, db);
    const records = await listImageRecords(dataset.id, db);
    return {
      schemaVersion: 1,
      dataset: dataset.name,
      model: { id: model.id, classes: model.classes, area: model.area },
      images: records.map(
        ({ image, detection, annotation, dish, unclear }) => ({
          digest: image.digest,
          width: image.width,
          height: image.height,
          filename: image.filename,
          bytes: image.bytes,
          split: image.split,
          coverage: model.area === "dish" ? dish.coverage : null,
          detection,
          annotation,
          unclear,
        }),
      ),
    };
  });
}

function listed(digests: string[]): string {
  return digests.join(", ");
}

/**
 * Creates the dataset a manifest describes. The workbench must know the
 * manifest's model and declare every class the manifest annotates with, in
 * the manifest's order: a dataset annotated before its model came to tell
 * more states apart holds none of them. It must hold every image it names as
 * the bytes it describes, and must have no dataset of that name and no review
 * of those images for that model: a manifest adds to a workbench, never
 * changes what a reviewer decided here. For the same reason the manifest
 * only adds marks of unclear photographs and never clears one made here.
 * Detections and coverage in the manifest are what another workbench's
 * versions and analysis found and are not recorded; this workbench reads its
 * own, and the model's area here is its own setting.
 */
export async function importDataset(
  manifest: DatasetManifest,
): Promise<Dataset> {
  return transaction(async (db) => {
    const addedAt = await operationTime(db);
    const model = await requireModel(manifest.model.id, db);
    if (!classesAmong(manifest.model.classes, model.classes)) {
      throw new DatasetImportInvalidError(
        `Model ${model.id} has classes ${listed(model.classes)}, not ${listed(manifest.model.classes)}`,
      );
    }
    let dataset: Dataset;
    try {
      dataset = await insertDataset(
        { name: manifest.dataset, modelId: model.id },
        addedAt,
        db,
      );
    } catch (error) {
      if (error instanceof DatasetNameTakenError)
        throw new DatasetImportInvalidError(
          `Dataset ${manifest.dataset} already exists`,
        );
      throw error;
    }
    const digests = manifest.images.map((image) => image.digest).sort();
    for (const digest of digests) await lockImage(digest, db);
    const stored = new Map(
      digests.length === 0
        ? []
        : (
            await db
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
      throw new DatasetImportInvalidError(
        `Images are not stored: ${listed(missing)}`,
      );
    }
    const mismatched = manifest.images.filter((image) => {
      const storedImage = stored.get(image.digest)!;
      return (
        storedImage.width !== image.width ||
        storedImage.height !== image.height ||
        storedImage.bytes !== image.bytes
      );
    });
    if (mismatched.length > 0) {
      throw new DatasetImportInvalidError(
        `Images have other metadata here: ${listed(mismatched.map((image) => image.digest))}`,
      );
    }
    const reviewing = manifest.images.filter(
      (
        image,
      ): image is typeof image & {
        annotation: NonNullable<typeof image.annotation>;
      } => image.annotation !== null,
    );
    if (reviewing.length > 0) {
      const reviewed = await db
        .select({ digest: annotations.imageId })
        .from(annotations)
        .where(eq(annotations.modelId, model.id))
        .then((rows) => new Set(rows.map((row) => row.digest)));
      const conflicting = reviewing.filter((image) =>
        reviewed.has(image.digest),
      );
      if (conflicting.length > 0) {
        throw new DatasetImportInvalidError(
          `Images are already reviewed for ${model.id}: ${listed(conflicting.map((image) => image.digest))}`,
        );
      }
    }
    if (manifest.images.length > 0) {
      await db.insert(datasetImages).values(
        manifest.images.map((image) => ({
          datasetId: dataset.id,
          imageId: image.digest,
          filename: image.filename,
          split: image.split,
          addedAt,
        })),
      );
    }
    await insertUnclearImages(
      manifest.images
        .filter((image) => image.unclear)
        .map((image) => image.digest),
      db,
    );
    await insertImportedAnnotations(
      model.id,
      reviewing.map((image) => image.annotation),
      addedAt,
      db,
    );
    return dataset;
  });
}
