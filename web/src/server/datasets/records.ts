import { and, eq, isNotNull } from "drizzle-orm";

import type { AnnotationDocument } from "../../domain/annotation/schema";
import type {
  DatasetImageOverview,
  DatasetOverview,
} from "../../domain/datasets/read-model";
import type { DatasetContents } from "../../domain/datasets/schema";
import type { DetectionResult } from "../../domain/detection/schema";
import { markedUnclear } from "../images/public";
import { shownDetectingVersion } from "../inference/public";
import {
  database,
  type Executor,
  inSnapshot,
  snapshot,
} from "../infra/db/client";
import { datasetImages, datasets, images } from "../infra/db/schema";
import { imageDetection, imageReadings } from "../readings/public";
import {
  type DatasetImage,
  datasetMembershipOrder,
  listDatasets,
  listDatasetsForModel,
  type MembershipRow,
  readDataset,
  toDatasetImage,
} from "./datasets";

/**
 * A dataset image with the documents that decide its state, loaded in one
 * query. The annotation is the review for the dataset's model; the detection
 * is the one a reviewer is shown, the current version's once it has detected
 * the image, else the newest version's that has; the proposal is the newest
 * an agent drew for it.
 */
export interface ImageRecord {
  image: DatasetImage;
  modelId: string;
  detection: DetectionResult | null;
  proposal: AnnotationDocument | null;
  annotation: AnnotationDocument | null;
  /** Whether a person marked the photograph unclear. */
  unclear: boolean;
}

/** An image that has been reviewed; the annotation is present by construction. */
export interface ReviewedRecord extends ImageRecord {
  annotation: AnnotationDocument;
}

export function summarizeDatasetImage(
  record: ImageRecord,
): DatasetImageOverview {
  const { image, detection, annotation } = record;
  return {
    dataset: image.dataset,
    digest: image.digest,
    filename: image.filename,
    detectionCount: detection?.instances.length ?? null,
    proposalCount: record.proposal?.instances.length ?? null,
    reviewCount: annotation?.instances.length ?? null,
    quality: detection?.quality ?? null,
    unclear: record.unclear,
  };
}

/** Memberships with their images and the documents that decide their state. */
function recordQuery(db: Executor) {
  const readings = imageReadings({
    imageId: datasetImages.imageId,
    modelId: datasets.modelId,
  });
  const detection = imageDetection({
    imageId: datasetImages.imageId,
    version: shownDetectingVersion(datasetImages.imageId, datasets.modelId),
  });
  return detection.join(
    readings.join(
      db
        .select({
          membership: datasetImages,
          image: images,
          modelId: datasets.modelId,
          detection: detection.detection,
          proposal: readings.proposalDocument,
          annotation: readings.annotation,
          unclear: markedUnclear(datasetImages.imageId),
        })
        .from(datasetImages)
        .innerJoin(images, eq(images.id, datasetImages.imageId))
        .innerJoin(datasets, eq(datasets.id, datasetImages.datasetId))
        .$dynamic(),
    ),
  );
}

function toRecord(
  row: MembershipRow & {
    modelId: string;
    detection: DetectionResult | null;
    proposal: AnnotationDocument | null;
    annotation: AnnotationDocument | null;
    unclear: boolean;
  },
): ImageRecord {
  return {
    image: toDatasetImage(row),
    modelId: row.modelId,
    detection: row.detection,
    proposal: row.proposal,
    annotation: row.annotation,
    unclear: row.unclear,
  };
}

export async function listImageRecords(
  datasetId: string,
  db?: Executor,
): Promise<ImageRecord[]> {
  const rows = await recordQuery(db ?? (await database()))
    .where(eq(datasetImages.datasetId, datasetId))
    .orderBy(...datasetMembershipOrder());
  return rows.map(toRecord);
}

/**
 * Images that have been reviewed, the only ones training may use.
 */
export async function listReviewedRecords(
  datasetId: string,
  db: Executor,
): Promise<ReviewedRecord[]> {
  const query = recordQuery(db)
    .where(({ annotation }) =>
      and(eq(datasetImages.datasetId, datasetId), isNotNull(annotation)),
    )
    .orderBy(...datasetMembershipOrder());
  const rows = await query.for("share", { of: datasetImages });
  return rows
    .map(toRecord)
    .flatMap((record) =>
      record.annotation ? [{ ...record, annotation: record.annotation }] : [],
    );
}

export function countReviewedDatasetImages(records: ImageRecord[]): number {
  return records.filter((record) => record.annotation !== null).length;
}

/** Every dataset, or those training one model, with its image and review counts. */
export async function listDatasetOverviews(
  modelId?: string,
  db?: Executor,
): Promise<DatasetOverview[]> {
  return inSnapshot(db, async (db) => {
    const datasets = modelId
      ? await listDatasetsForModel(modelId, db)
      : await listDatasets(db);
    return Promise.all(
      datasets.map(async (dataset) => {
        const records = await listImageRecords(dataset.id, db);
        return {
          dataset,
          imageCount: records.length,
          reviewedCount: countReviewedDatasetImages(records),
        };
      }),
    );
  });
}

/** One dataset's images, or null when no dataset has the id. */
export async function readDatasetContents(
  datasetId: string,
): Promise<DatasetContents | null> {
  return snapshot(async (db) => {
    const dataset = await readDataset(datasetId, db);
    if (!dataset) return null;
    const records = await listImageRecords(datasetId, db);
    return {
      dataset,
      images: records.map(({ image, annotation, unclear }) => ({
        digest: image.digest,
        filename: image.filename,
        reviewed: annotation !== null,
        split: image.split,
        unclear,
      })),
    };
  });
}
