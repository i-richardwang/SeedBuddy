import { z } from "zod";

import { imageDigestSchema } from "../images/schema";
import type { ExperimentGridDetail } from "./read-model";
import { calendarDaySchema } from "./schema";

/** A photograph an experiment holds, named by the unit and day it shows. */
export const placedPhotoSchema = z.strictObject({
  digest: imageDigestSchema,
  filename: z.string(),
  unit: z.string(),
  observedOn: calendarDaySchema,
});

export type PlacedPhoto = z.infer<typeof placedPhotoSchema>;

/** Why a photograph in a batch cannot take a unit. */
export type PhotoConflict =
  | { kind: "placed"; placed: PlacedPhoto }
  | { kind: "repeated"; filename: string };

/** The photographs a grid holds, each with the unit and day it shows. */
export function placedPhotos(
  grid: Pick<ExperimentGridDetail, "units" | "observations" | "images">,
): PlacedPhoto[] {
  const codes = new Map(grid.units.map((unit) => [unit.id, unit.code]));
  const days = new Map(
    grid.observations.map((observation) => [
      observation.id,
      observation.observedOn,
    ]),
  );
  return grid.images.map((image) => ({
    digest: image.digest,
    filename: image.filename,
    unit: codes.get(image.unit)!,
    observedOn: days.get(image.observation)!,
  }));
}

/**
 * An experiment holds each photograph once. A photograph it already holds
 * cannot take a unit, and neither can a later copy of one earlier in the
 * same batch; every other photograph is free.
 */
export function photoConflicts<Id>(
  batch: readonly { id: Id; digest: string; filename: string }[],
  placed: readonly PlacedPhoto[],
): Map<Id, PhotoConflict> {
  const held = new Map(placed.map((photo) => [photo.digest, photo]));
  const first = new Map<string, string>();
  const conflicts = new Map<Id, PhotoConflict>();
  for (const photo of batch) {
    const holding = held.get(photo.digest);
    const earlier = first.get(photo.digest);
    if (holding) conflicts.set(photo.id, { kind: "placed", placed: holding });
    else if (earlier !== undefined) {
      conflicts.set(photo.id, { kind: "repeated", filename: earlier });
    } else first.set(photo.digest, photo.filename);
  }
  return conflicts;
}
