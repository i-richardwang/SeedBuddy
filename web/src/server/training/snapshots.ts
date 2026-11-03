import { and, asc, count, eq, inArray } from "drizzle-orm";

import { DatasetNotFoundError } from "../../domain/datasets/errors";
import { TrainingRunConflictError } from "../../domain/training/errors";
import {
  type DatasetSnapshot,
  datasetSnapshotSchema,
  IMAGE_SPLITS,
  type ImageSplit,
  MIN_SNAPSHOT_IMAGES,
} from "../../domain/training/schema";
import type { AttemptOwner } from "../../domain/workers/schema";
import {
  listReviewedRecords,
  type ReviewedRecord,
  readDataset,
} from "../datasets/public";
import { database, type Executor } from "../infra/db/client";
import {
  datasetImages,
  datasetSnapshotImages,
  datasetSnapshots,
  images,
} from "../infra/db/schema";
import { contentDigest } from "../infra/digest";
import { readModel } from "../models/public";
import { requireOwnedRunningRun, requireTrainingRun } from "./ownership";

/**
 * Gives every reviewed image a split it keeps across later snapshots, and
 * guarantees the set trains and validates on something.
 */
async function assignSplits(
  datasetId: string,
  reviewed: ReviewedRecord[],
  tx: Executor,
): Promise<Map<string, ImageSplit>> {
  const splits = new Map<string, ImageSplit>();
  const assignedNow: ReviewedRecord[] = [];
  for (const record of reviewed) {
    if (record.image.split) {
      splits.set(record.image.digest, record.image.split);
      continue;
    }
    const bucket =
      Number.parseInt(contentDigest(record.image.digest).slice(0, 8), 16) /
      0xffffffff;
    splits.set(record.image.digest, bucket < 0.2 ? "val" : "train");
    assignedNow.push(record);
  }
  const extreme = (direction: 1 | -1) =>
    [...assignedNow].sort(
      (a, b) =>
        direction *
        contentDigest(a.image.digest).localeCompare(
          contentDigest(b.image.digest),
        ),
    )[0];
  for (const split of ["val", "train"] as const) {
    if ([...splits.values()].includes(split)) continue;
    const record = extreme(split === "val" ? 1 : -1);
    if (!record) {
      throw new Error(
        `Stable split has no ${split === "val" ? "validation" : "training"} image; add another reviewed image`,
      );
    }
    splits.set(record.image.digest, split);
  }
  for (const split of IMAGE_SPLITS) {
    const digests = assignedNow
      .filter((record) => splits.get(record.image.digest) === split)
      .map((record) => record.image.digest);
    if (digests.length === 0) continue;
    await tx
      .update(datasetImages)
      .set({ split })
      .where(
        and(
          eq(datasetImages.datasetId, datasetId),
          inArray(datasetImages.imageId, digests),
        ),
      );
  }
  return splits;
}

async function snapshotImages(snapshotId: string, db: Executor) {
  return db
    .select({
      digest: datasetSnapshotImages.imageId,
      width: images.width,
      height: images.height,
      split: datasetSnapshotImages.split,
      annotation: datasetSnapshotImages.annotation,
    })
    .from(datasetSnapshotImages)
    .innerJoin(images, eq(images.id, datasetSnapshotImages.imageId))
    .where(eq(datasetSnapshotImages.snapshotId, snapshotId))
    .orderBy(asc(datasetSnapshotImages.imageId));
}

export async function readDatasetSnapshot(
  snapshotId: string,
  db?: Executor,
): Promise<DatasetSnapshot | null> {
  const executor = db ?? (await database());
  const [row] = await executor
    .select()
    .from(datasetSnapshots)
    .where(eq(datasetSnapshots.id, snapshotId));
  if (!row) return null;
  const model = await readModel(row.modelId, executor);
  if (!model) throw new Error(`Unknown model: ${row.modelId}`);
  return datasetSnapshotSchema.parse({
    schemaVersion: 1,
    id: row.id,
    datasetId: row.datasetId,
    modelId: row.modelId,
    classes: model.classes,
    createdAt: row.createdAt.toISOString(),
    images: await snapshotImages(snapshotId, executor),
  });
}

/**
 * Freezes the reviewed annotations into a snapshot named by their content.
 * Images are referenced, not copied: the snapshot rows keep the bytes alive.
 * An identical set returns the existing snapshot.
 */
export async function createDatasetSnapshot(
  datasetId: string,
  tx: Executor,
): Promise<DatasetSnapshot> {
  const dataset = await readDataset(datasetId, tx);
  if (!dataset) throw new DatasetNotFoundError(`Unknown dataset: ${datasetId}`);
  const reviewed = await listReviewedRecords(datasetId, tx, true);
  if (reviewed.length < MIN_SNAPSHOT_IMAGES) {
    throw new TrainingRunConflictError(
      `Training requires at least ${MIN_SNAPSHOT_IMAGES} reviewed images`,
    );
  }
  const splits = await assignSplits(datasetId, reviewed, tx);
  const members = reviewed
    .map(({ image, annotation }) => {
      const split = splits.get(image.digest);
      if (!split) throw new Error(`Image ${image.digest} has no split`);
      return { digest: image.digest, split, annotation };
    })
    .sort((a, b) => a.digest.localeCompare(b.digest));
  const snapshotId = `snapshot-${contentDigest(
    JSON.stringify({ datasetId, modelId: dataset.modelId, members }),
  )}`;
  const existing = await readDatasetSnapshot(snapshotId, tx);
  if (existing) return existing;
  await tx.insert(datasetSnapshots).values({
    id: snapshotId,
    datasetId,
    modelId: dataset.modelId,
    createdAt: new Date(),
  });
  await tx.insert(datasetSnapshotImages).values(
    members.map(({ digest, split, annotation }) => ({
      snapshotId,
      modelId: dataset.modelId,
      imageId: digest,
      split,
      annotation,
    })),
  );
  const created = await readDatasetSnapshot(snapshotId, tx);
  if (!created) throw new Error(`Snapshot ${snapshotId} was not created`);
  return created;
}

/** The training set each snapshot was taken of, and how many reviewed images it froze. */
export async function datasetSnapshotOverviews(
  snapshotIds: string[],
): Promise<Map<string, { datasetId: string; images: number }>> {
  if (snapshotIds.length === 0) return new Map();
  const db = await database();
  const rows = await db
    .select({
      id: datasetSnapshots.id,
      datasetId: datasetSnapshots.datasetId,
      images: count(datasetSnapshotImages.snapshotId),
    })
    .from(datasetSnapshots)
    .leftJoin(
      datasetSnapshotImages,
      eq(datasetSnapshotImages.snapshotId, datasetSnapshots.id),
    )
    .where(inArray(datasetSnapshots.id, snapshotIds))
    .groupBy(datasetSnapshots.id);
  return new Map(rows.map(({ id, ...summary }) => [id, summary]));
}

export async function snapshotForRun(runId: string, owner: AttemptOwner) {
  const db = await database();
  const stored = await requireTrainingRun(runId, db);
  const run = await requireOwnedRunningRun(stored, owner, db);
  const snapshot = await readDatasetSnapshot(run.datasetSnapshotId, db);
  if (!snapshot) throw new Error(`Missing snapshot ${run.datasetSnapshotId}`);
  return snapshot;
}
