import { and, eq, isNotNull, sql } from "drizzle-orm";

import type { AnnotationDocument } from "../../domain/annotation/schema";
import type {
  DatasetContents,
  DatasetImageRef,
  DatasetSummary,
} from "../../domain/datasets/schema";
import type {
  DetectionQuality,
  DetectionResult,
} from "../../domain/detection/schema";
import { markedUnclear } from "../images/public";
import { shownDetectingVersion } from "../inference/public";
import { database, type Executor } from "../infra/db/client";
import {
  datasetImages,
  datasets,
  images,
} from "../infra/db/schema";
import { readingsSubquery } from "../readings/public";
import {
  type DatasetImage,
  listDatasets,
  listDatasetsForModel,
  type MembershipRow,
  membershipOrder,
  readDataset,
  toDatasetImage,
} from "./memberships";

export interface ImageSummary extends DatasetImageRef {
  filename: string;
  /** Boxes of the newest detection, or null until a version has run. */
  detectionCount: number | null;
  /** Boxes of the newest AI proposal, or null until an agent has drawn one. */
  proposalCount: number | null;
  /** Boxes of the stored review, or null until someone has reviewed the image. */
  reviewCount: number | null;
  quality: DetectionQuality | null;
  /** Whether a person marked the photograph unclear; it trains all the same. */
  unclear: boolean;
}

/**
 * A dataset image with the documents that decide its state, loaded in one
 * query. The annotation is the review for the dataset's model; the detection
 * is the newest the model's versions recorded for the image; the proposal is
 * the newest an agent drew for it.
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

export function summarize(record: ImageRecord): ImageSummary {
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
  const readings = readingsSubquery(db, {
    modelId: datasets.modelId,
    version: shownDetectingVersion(datasetImages.imageId, datasets.modelId),
  });
  return db
      .select({
        membership: datasetImages,
        image: images,
        modelId: datasets.modelId,
        detection: readings.detection,
        proposal: sql<AnnotationDocument | null>`${readings.proposal}->'document'`,
        annotation: readings.annotation,
        unclear: markedUnclear(datasetImages.imageId),
      })
      .from(datasetImages)
      .innerJoin(images, eq(images.id, datasetImages.imageId))
      .innerJoin(datasets, eq(datasets.id, datasetImages.datasetId))
      .leftJoinLateral(readings, eq(readings.imageId, datasetImages.imageId));
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
): Promise<ImageRecord[]> {
  const rows = await recordQuery(await database())
    .where(eq(datasetImages.datasetId, datasetId))
    .orderBy(...membershipOrder());
  return rows.map(toRecord);
}

/**
 * Images that have been reviewed, the only ones training may use. With
 * `lock`, the memberships are share-locked so a removal waits for the
 * caller's transaction.
 */
export async function listReviewedRecords(
  datasetId: string,
  db: Executor,
  lock = false,
): Promise<ReviewedRecord[]> {
  const query = recordQuery(db)
    .where(({ annotation }) =>
      and(eq(datasetImages.datasetId, datasetId), isNotNull(annotation)),
    )
    .orderBy(...membershipOrder());
  const rows = lock
    ? await query.for("share", { of: datasetImages })
    : await query;
  return rows
    .map(toRecord)
    .flatMap((record) =>
      record.annotation ? [{ ...record, annotation: record.annotation }] : [],
    );
}

export function countReviewed(records: ImageRecord[]): number {
  return records.filter((record) => record.annotation !== null).length;
}

/** Every dataset, or those training one model, with its image and review counts. */
export async function listDatasetSummaries(
  modelId?: string,
): Promise<DatasetSummary[]> {
  const datasets = modelId
    ? await listDatasetsForModel(modelId)
    : await listDatasets();
  return Promise.all(
    datasets.map(async (dataset) => {
      const records = await listImageRecords(dataset.id);
      return {
        dataset,
        imageCount: records.length,
        reviewedCount: countReviewed(records),
      };
    }),
  );
}

/** One dataset's images, or null when no dataset has the id. */
export async function readDatasetContents(
  datasetId: string,
): Promise<DatasetContents | null> {
  const dataset = await readDataset(datasetId);
  if (!dataset) return null;
  const records = await listImageRecords(datasetId);
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
}
