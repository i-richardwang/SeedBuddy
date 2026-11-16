/**
 * Batches of photographs an account uploaded and has yet to place in an
 * experiment. Placing a photograph takes it out of its batches, and a batch
 * lasts until its last photograph is placed or its owner deletes it.
 *
 * Writes take their locks in one order: images, then the batch, then the
 * batch's photographs. A batch's photographs change only under its lock,
 * shared by those that add or remove one and exclusive for the one that
 * may delete the batch.
 */
import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, inArray, notExists } from "drizzle-orm";

import { ImageNotFoundError } from "../../domain/images/errors";
import { PhotoBatchNotFoundError } from "../../domain/photos/errors";
import type {
  PhotoBatchDetail,
  PhotoBatchOverview,
} from "../../domain/photos/read-model";
import type {
  BatchPhotoAddition,
  BatchPhotoRef,
  PhotoBatch,
  PhotoBatchRef,
  PhotoBatchRequest,
} from "../../domain/photos/schema";
import { lockImage } from "../images/public";
import {
  database,
  type Executor,
  operationTime,
  single,
  snapshot,
  transaction,
} from "../infra/db/client";
import { images, photoBatches, photoBatchPhotos } from "../infra/db/schema";

function toBatch(row: typeof photoBatches.$inferSelect): PhotoBatch {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The account's own batch: another account's is as absent as none. */
function ownBatch(owner: string, batch: string) {
  return and(eq(photoBatches.id, batch), eq(photoBatches.ownerId, owner));
}

export async function createPhotoBatch(
  owner: string,
  { name }: PhotoBatchRequest,
): Promise<PhotoBatch> {
  return transaction(async (db) => {
    const rows = await db
      .insert(photoBatches)
      .values({
        id: randomUUID(),
        ownerId: owner,
        name,
        createdAt: await operationTime(db),
      })
      .returning();
    return toBatch(single(rows, "photo_batches"));
  });
}

/**
 * Deletes a batch with the photographs still waiting in it. Their bytes go
 * with the next collection unless something else refers to them.
 */
export async function deletePhotoBatch(
  owner: string,
  { batch }: PhotoBatchRef,
): Promise<void> {
  const deleted = await (
    await database()
  )
    .delete(photoBatches)
    .where(ownBatch(owner, batch))
    .returning({ id: photoBatches.id });
  if (deleted.length === 0) {
    throw new PhotoBatchNotFoundError(`Unknown photo batch: ${batch}`);
  }
}

/**
 * Adds a stored photograph to a batch under the name it was uploaded with.
 * One the batch already holds keeps the name it has.
 */
export async function addBatchPhoto(
  owner: string,
  { batch, digest, filename }: BatchPhotoAddition,
): Promise<void> {
  await transaction(async (db) => {
    await lockImage(digest, db);
    const [held] = await db
      .select({ id: photoBatches.id })
      .from(photoBatches)
      .where(ownBatch(owner, batch))
      .for("share");
    if (!held) {
      throw new PhotoBatchNotFoundError(`Unknown photo batch: ${batch}`);
    }
    const [stored] = await db
      .select({ id: images.id })
      .from(images)
      .where(eq(images.id, digest));
    if (!stored) throw new ImageNotFoundError(`Unknown image: ${digest}`);
    await db
      .insert(photoBatchPhotos)
      .values({ batchId: batch, imageId: digest, filename })
      .onConflictDoNothing();
  });
}

/** Takes a photograph out of a batch, which stays; one it does not hold is passed over. */
export async function removeBatchPhoto(
  owner: string,
  { batch, digest }: BatchPhotoRef,
): Promise<void> {
  await transaction(async (db) => {
    const [held] = await db
      .select({ id: photoBatches.id })
      .from(photoBatches)
      .where(ownBatch(owner, batch))
      .for("share");
    if (!held) {
      throw new PhotoBatchNotFoundError(`Unknown photo batch: ${batch}`);
    }
    await db
      .delete(photoBatchPhotos)
      .where(
        and(
          eq(photoBatchPhotos.batchId, batch),
          eq(photoBatchPhotos.imageId, digest),
        ),
      );
  });
}

/**
 * Takes photographs just placed in an experiment out of every batch they
 * wait in, whoever placed them, and deletes each batch this leaves empty:
 * a batch is done once its last photograph is placed. The caller holds the
 * images' locks, so no batch gains one of these photographs meanwhile, and
 * a photograph being added to a batch is in it before the batch is judged
 * empty.
 */
export async function releasePlacedPhotos(
  digests: string[],
  db: Executor,
): Promise<void> {
  const waiting = await db
    .selectDistinct({ batchId: photoBatchPhotos.batchId })
    .from(photoBatchPhotos)
    .where(inArray(photoBatchPhotos.imageId, digests));
  if (waiting.length === 0) return;
  const batches = waiting.map((row) => row.batchId);
  await db
    .select({ id: photoBatches.id })
    .from(photoBatches)
    .where(inArray(photoBatches.id, batches))
    .orderBy(asc(photoBatches.id))
    .for("update");
  await db
    .delete(photoBatchPhotos)
    .where(inArray(photoBatchPhotos.imageId, digests));
  await db
    .delete(photoBatches)
    .where(
      and(
        inArray(photoBatches.id, batches),
        notExists(
          db
            .select({ imageId: photoBatchPhotos.imageId })
            .from(photoBatchPhotos)
            .where(eq(photoBatchPhotos.batchId, photoBatches.id)),
        ),
      ),
    );
}

/** The account's batches, the newest first, each with how many photographs wait in it. */
export async function listPhotoBatchOverviews(
  owner: string,
): Promise<PhotoBatchOverview[]> {
  const rows = await (
    await database()
  )
    .select({
      batch: photoBatches,
      photoCount: count(photoBatchPhotos.imageId),
    })
    .from(photoBatches)
    .leftJoin(photoBatchPhotos, eq(photoBatchPhotos.batchId, photoBatches.id))
    .where(eq(photoBatches.ownerId, owner))
    .groupBy(photoBatches.id)
    .orderBy(desc(photoBatches.createdAt), asc(photoBatches.id));
  return rows.map((row) => ({
    ...toBatch(row.batch),
    photoCount: row.photoCount,
  }));
}

/** File names in the order a camera numbers them, whatever the reader's locale. */
const byFilename = new Intl.Collator("en", { numeric: true });

/**
 * One of the account's batches with its waiting photographs, or null. The
 * photographs come in the order of their file names, numbers compared by
 * value: the order they were taken in, which upload does not keep.
 */
export async function photoBatchDetail(
  owner: string,
  { batch }: PhotoBatchRef,
): Promise<PhotoBatchDetail | null> {
  return snapshot(async (db) => {
    const [row] = await db
      .select()
      .from(photoBatches)
      .where(ownBatch(owner, batch));
    if (!row) return null;
    const photos = await db
      .select({
        digest: images.id,
        filename: photoBatchPhotos.filename,
        width: images.width,
        height: images.height,
        bytes: images.bytes,
      })
      .from(photoBatchPhotos)
      .innerJoin(images, eq(images.id, photoBatchPhotos.imageId))
      .where(eq(photoBatchPhotos.batchId, batch));
    photos.sort(
      (a, b) =>
        byFilename.compare(a.filename, b.filename) ||
        (a.digest < b.digest ? -1 : 1),
    );
    return { batch: toBatch(row), photos };
  });
}
