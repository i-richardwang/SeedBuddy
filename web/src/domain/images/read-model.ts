import type { AnnotationRef } from "../annotation/schema";

/** Where a person sees an image: a unit's photograph of a day, or a dataset's. */
export type ImagePlace =
  | { experiment: string; unit: string; observedOn: string }
  | { dataset: string };

export interface ImageSearchOverview {
  ref: AnnotationRef;
  filename: string;
  places: ImagePlace[];
}
