import { and, eq, inArray } from "drizzle-orm";

import type { PlacedPhoto } from "../../domain/experiments/photos";
import { atImageObservation, atImageUnit } from "../experiments/public";
import { snapshot } from "../infra/db/client";
import {
  experimentObservationImages,
  experimentObservations,
  experimentUnits,
} from "../infra/db/schema";

/**
 * Which of the photographs named the experiment already holds, each with the
 * unit and day it shows. An experiment holds a photograph once.
 */
export function findPlacedPhotos(
  experimentId: string,
  digests: readonly string[],
): Promise<PlacedPhoto[]> {
  if (digests.length === 0) return Promise.resolve([]);
  return snapshot((db) =>
    db
      .select({
        digest: experimentObservationImages.imageId,
        filename: experimentObservationImages.filename,
        unit: experimentUnits.code,
        observedOn: experimentObservations.observedOn,
      })
      .from(experimentObservationImages)
      .innerJoin(experimentObservations, atImageObservation())
      .innerJoin(experimentUnits, atImageUnit())
      .where(
        and(
          eq(experimentObservationImages.experimentId, experimentId),
          inArray(experimentObservationImages.imageId, [...digests]),
        ),
      ),
  );
}
