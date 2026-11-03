import { asc, inArray } from "drizzle-orm";

import { atImageObservation } from "../experiments/public";
import { type Executor, inSnapshot } from "../infra/db/client";
import {
  datasetImages,
  experimentObservationImages,
  experimentObservations,
} from "../infra/db/schema";

/**
 * A display name for each image: its source filename in
 * the earliest observation, or failing that its earliest dataset membership.
 * Images carry no name of their own.
 */
export async function imageFilenames(
  digests: string[],
  db?: Executor,
): Promise<Map<string, string>> {
  if (digests.length === 0) return new Map();
  return inSnapshot(db, async (db) => {
    const [experimentRows, datasetRows] = await Promise.all([
      db
        .select({
          imageId: experimentObservationImages.imageId,
          filename: experimentObservationImages.filename,
        })
        .from(experimentObservationImages)
        .innerJoin(experimentObservations, atImageObservation())
        .where(inArray(experimentObservationImages.imageId, digests))
        .orderBy(
          asc(experimentObservations.observedOn),
          asc(experimentObservations.createdAt),
          asc(experimentObservationImages.experimentId),
          asc(experimentObservationImages.id),
        ),
      db
        .select({
          imageId: datasetImages.imageId,
          filename: datasetImages.filename,
        })
        .from(datasetImages)
        .where(inArray(datasetImages.imageId, digests))
        .orderBy(asc(datasetImages.addedAt), asc(datasetImages.datasetId)),
    ]);
    const names = new Map<string, string>();
    for (const row of [...experimentRows, ...datasetRows]) {
      if (!names.has(row.imageId)) names.set(row.imageId, row.filename);
    }
    return names;
  });
}
