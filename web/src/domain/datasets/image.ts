import type { Review } from "../annotation/readings";
import type { Model } from "../models/schema";
import type { ImageSplit } from "../training/schema";
import type { Dataset } from "./schema";

export interface DatasetImageStep {
  digest: string;
  filename: string;
}

export interface DatasetImageView {
  dataset: Dataset;
  model: Model;
  review: Review;
  /** Whether a person marked the photograph unclear. */
  unclear: boolean;
  split: ImageSplit | null;
  /** Where the image stands in the dataset's order, counted from 1. */
  position: { index: number; total: number };
  previous: DatasetImageStep | null;
  next: DatasetImageStep | null;
  /** The first image after this one, wrapping around, that nobody has reviewed. */
  nextUnreviewed: DatasetImageStep | null;
}
