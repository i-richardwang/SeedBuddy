/**
 * Whether a photograph could be read clearly is said of the canonical image,
 * wherever it is shown. Marking or clearing it changes no reading: the units' table,
 * the spreadsheet and the dataset pages read the mark beside the readings
 * they have.
 */
import { type Column, eq, inArray, type SQL, sql } from "drizzle-orm";

import type { ImageRef } from "../../domain/images/schema";
import type {
  UnclearCleared,
  UnclearMarked,
} from "../../domain/images/unclear";
import { database, type Executor, inTransaction } from "../infra/db/client";
import { unclearImages } from "../infra/db/schema";
import { lockImage } from "./lock";
import { requireStoredImage } from "./records";

/** Whether the image a query names is marked unclear, as a column of that query. */
export function markedUnclear(imageId: Column): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${unclearImages} where ${unclearImages.imageId} = ${imageId})`;
}

/** Marks the image unclear. Marking one already marked is harmless. */
export async function markImageUnclear(
  { digest }: ImageRef,
  db?: Executor,
): Promise<UnclearMarked> {
  return inTransaction(db, async (db) => {
    await lockImage(digest, db);
    await requireStoredImage(digest, db);
    const added = await db
      .insert(unclearImages)
      .values({ imageId: digest })
      .onConflictDoNothing()
      .returning({ imageId: unclearImages.imageId });
    return { digest, marked: added.length > 0 };
  });
}

/** Insert marks after the caller has locked and verified every image. */
export async function insertUnclearImages(
  digests: readonly string[],
  db: Executor,
): Promise<void> {
  if (!digests.length) return;
  await db
    .insert(unclearImages)
    .values([...new Set(digests)].map((imageId) => ({ imageId })))
    .onConflictDoNothing();
}

/** Clears the image's mark: it reads as clear again. Clearing twice is harmless. */
export async function clearImageUnclear(
  { digest }: ImageRef,
  db?: Executor,
): Promise<UnclearCleared> {
  return inTransaction(db, async (db) => {
    await lockImage(digest, db);
    await requireStoredImage(digest, db);
    const removed = await db
      .delete(unclearImages)
      .where(eq(unclearImages.imageId, digest))
      .returning({ imageId: unclearImages.imageId });
    return { digest, cleared: removed.length > 0 };
  });
}

/** Which of the named images are marked unclear. */
export async function readUnclearImages(
  digests: readonly string[],
  db?: Executor,
): Promise<Set<string>> {
  if (digests.length === 0) return new Set();
  db ??= await database();
  const rows = await db
    .select({ imageId: unclearImages.imageId })
    .from(unclearImages)
    .where(inArray(unclearImages.imageId, [...new Set(digests)]));
  return new Set(rows.map((row) => row.imageId));
}
