import { type Column, eq, inArray, type SQL, sql } from "drizzle-orm";

import { ImageNotFoundError } from "../../domain/images/errors";
import type { ImageRef } from "../../domain/images/schema";
import type {
  UnclearCleared,
  UnclearMarked,
} from "../../domain/images/unclear";
import { database, type Executor, inTransaction } from "../infra/db/client";
import { images, unclearImages } from "../infra/db/schema";
import { lockImage } from "./lock";

/**
 * Whether a photograph could be read clearly is said of the canonical image,
 * wherever it is shown. Marking or clearing it changes no reading: the grid,
 * the spreadsheet and the dataset pages read the mark beside the readings
 * they have.
 */

/** Whether the image a query names is marked unclear, as a column of that query. */
export function markedUnclear(imageId: Column): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${unclearImages} where ${unclearImages.imageId} = ${imageId})`;
}

async function requireStoredImage(digest: string, tx: Executor) {
  const [stored] = await tx
    .select({ id: images.id })
    .from(images)
    .where(eq(images.id, digest));
  if (!stored) throw new ImageNotFoundError(`Unknown image: ${digest}`);
}

/** Marks the image unclear. Marking one already marked is harmless. */
export async function markImageUnclear(
  { digest }: ImageRef,
  executor?: Executor,
): Promise<UnclearMarked> {
  return inTransaction(executor, async (tx) => {
    await lockImage(digest, tx);
    await requireStoredImage(digest, tx);
    const added = await tx
      .insert(unclearImages)
      .values({ imageId: digest })
      .onConflictDoNothing()
      .returning({ imageId: unclearImages.imageId });
    return { digest, marked: added.length > 0 };
  });
}

/** Marks several images unclear in one transaction, locking digests in sorted order. */
export async function markImagesUnclear(
  digests: readonly string[],
  tx: Executor,
): Promise<void> {
  for (const digest of [...new Set(digests)].sort()) {
    await markImageUnclear({ digest }, tx);
  }
}

/** Clears the image's mark: it reads as clear again. Clearing twice is harmless. */
export async function clearImageUnclear(
  { digest }: ImageRef,
  executor?: Executor,
): Promise<UnclearCleared> {
  return inTransaction(executor, async (tx) => {
    await lockImage(digest, tx);
    await requireStoredImage(digest, tx);
    const removed = await tx
      .delete(unclearImages)
      .where(eq(unclearImages.imageId, digest))
      .returning({ imageId: unclearImages.imageId });
    return { digest, cleared: removed.length > 0 };
  });
}

/** Which of the named images are marked unclear. */
export async function readUnclearImages(
  digests: readonly string[],
  executor?: Executor,
): Promise<Set<string>> {
  if (digests.length === 0) return new Set();
  const db = executor ?? (await database());
  const rows = await db
    .select({ imageId: unclearImages.imageId })
    .from(unclearImages)
    .where(inArray(unclearImages.imageId, [...new Set(digests)]));
  return new Set(rows.map((row) => row.imageId));
}
