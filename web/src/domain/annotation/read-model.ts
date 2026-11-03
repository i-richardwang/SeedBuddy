import type { AnnotationProgress } from "../annotation-runs/schema";
import type { AnnotationRef } from "./schema";
export interface PendingAnnotationOverview {
  ref: AnnotationRef;
  filename: string;
  /** The progress of the run already at work on it, which an agent continues. */
  progress: AnnotationProgress | null;
}

export interface PendingAnnotationsDetail {
  total: number;
  images: PendingAnnotationOverview[];
}
