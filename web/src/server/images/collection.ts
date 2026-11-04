import { and, asc, eq, lte, sql } from "drizzle-orm";

import { imageDigestSchema } from "../../domain/images/schema";
import { listBlobs, removeBlob } from "../infra/blobs/store";
import { database, operationTime, transaction } from "../infra/db/client";
import {
  annotationRuns,
  annotations,
  datasetImages,
  datasetSnapshotImages,
  experimentObservationImages,
  images,
} from "../infra/db/schema";
import { imageBlobKey, imagePreviewKey, imageRegionsPrefix } from "./keys";
import { lockImage } from "./lock";

/**
 * How long an image nobody has claimed is kept. Bytes are stored before
 * the observation they belong to is submitted, so the period covers a person
 * filling in the rest of the form, changing their mind, and coming back to it.
 */
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/** No experiment, dataset, snapshot, or review refers to the image. */
function unclaimed() {
  return sql`not exists (select 1 from ${experimentObservationImages} where ${experimentObservationImages.imageId} = ${images.id})
    and not exists (select 1 from ${datasetImages} where ${datasetImages.imageId} = ${images.id})
    and not exists (select 1 from ${datasetSnapshotImages} where ${datasetSnapshotImages.imageId} = ${images.id})
    and not exists (select 1 from ${annotationRuns} where ${annotationRuns.imageId} = ${images.id})
    and not exists (select 1 from ${annotations} where ${annotations.imageId} = ${images.id})`;
}

/**
 * Forgets expired images nothing refers to. This phase only commits database
 * state: leaving their immutable objects behind is safe, and the Blob sweep
 * below removes them after the rows are durably absent.
 */
async function forgetExpiredImages(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - GRACE_PERIOD_MS);
  const candidates = await (
    await database()
  )
    .select({ id: images.id })
    .from(images)
    .where(and(lte(images.receivedAt, cutoff), unclaimed()))
    .orderBy(asc(images.receivedAt), asc(images.id));
  for (const { id } of candidates) {
    await transaction(async (db) => {
      await lockImage(id, db);
      await db
        .delete(images)
        .where(
          and(eq(images.id, id), lte(images.receivedAt, cutoff), unclaimed()),
        );
    });
  }
}

/** Canonical bytes and everything derived from them share the lifetime of their Image row. */
async function sweepImageBlobs(): Promise<string[]> {
  const objects = new Map<string, string[]>();
  const [sources, previews, regions] = await Promise.all([
    listBlobs("images/"),
    listBlobs("image-previews/"),
    listBlobs("image-regions/"),
  ]);
  for (const key of [...sources, ...previews, ...regions]) {
    const candidate = key.startsWith("image-regions/")
      ? key.split("/")[1]
      : key.split("/").at(-1);
    const parsed = imageDigestSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const digest = parsed.data;
    if (
      key !== imageBlobKey(digest) &&
      key !== imagePreviewKey(digest) &&
      !key.startsWith(imageRegionsPrefix(digest))
    )
      continue;
    const keys = objects.get(digest) ?? [];
    keys.push(key);
    objects.set(digest, keys);
  }
  const collected: string[] = [];
  for (const [digest, keys] of objects) {
    const removed = await transaction(async (db) => {
      await lockImage(digest, db);
      const [row] = await db
        .select({ id: images.id })
        .from(images)
        .where(eq(images.id, digest));
      if (row) return false;
      for (const key of keys) await removeBlob(key);
      return true;
    });
    if (removed) collected.push(digest);
  }
  return collected;
}

/** Expires unclaimed Image rows, then sweeps every Blob no row roots. */
export async function collectImages(suppliedAt?: Date): Promise<string[]> {
  await forgetExpiredImages(await operationTime(await database(), suppliedAt));
  return sweepImageBlobs();
}
