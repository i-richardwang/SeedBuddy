import { z } from "zod";

import { imageDigestSchema } from "../images/schema";
import { calendarDaySchema, experimentIdSchema } from "./schema";

/** A photograph an experiment holds, named by the unit and day it shows. */
export const placedPhotoSchema = z.strictObject({
  digest: imageDigestSchema,
  filename: z.string(),
  unit: z.string(),
  observedOn: calendarDaySchema,
});

export type PlacedPhoto = z.infer<typeof placedPhotoSchema>;

/** The most photographs one question about a batch names. */
export const MAX_PLACED_PHOTOS_ASKED = 500;

/** Which of a batch's photographs, by digest, the experiment already holds. */
export const placedPhotosRequestSchema = z.strictObject({
  experiment: experimentIdSchema,
  digests: z.array(imageDigestSchema).max(MAX_PLACED_PHOTOS_ASKED),
});

/** Why a photograph in a batch cannot take a unit. */
export type PhotoConflict =
  | { kind: "placed"; placed: PlacedPhoto }
  | { kind: "repeated"; filename: string };

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
