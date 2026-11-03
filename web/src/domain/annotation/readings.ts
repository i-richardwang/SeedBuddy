import { z } from "zod";

import {
  annotationProgressSchema,
  annotationProposalSchema,
} from "../annotation-runs/schema";
import { detectionResultSchema } from "../detection/schema";
import { instancesFromDetection } from "./detection";
import {
  annotationRefSchema,
  annotationSchema,
  REVIEW_SOURCES,
  type AnnotationInstance,
  type ReviewSource,
} from "./schema";

/**
 * One image as it is read for one model.
 *
 * Three readings can exist, and they rank: `annotation` is what a reviewer
 * decided, `proposal` is what an AI agent drew, `detection` is what the
 * model's current version found. A reviewer's decision outranks the agent,
 * and the agent outranks the detector. Each is looked up on its own; the
 * ranking decides which one an image reads by. `progress` is that of the
 * run an agent is still at work on.
 */
const imageReadingsSchema = z.strictObject({
  ref: annotationRefSchema,
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  detection: detectionResultSchema.nullable(),
  proposal: annotationProposalSchema.nullable(),
  annotation: annotationSchema.nullable(),
  progress: annotationProgressSchema.nullable(),
});

export type ImageReadings = z.infer<typeof imageReadingsSchema>;

/** The readings as a page shows them, under the name the page knows the file by. */
export const reviewSchema = imageReadingsSchema.extend({
  filename: z.string(),
});

export type Review = z.infer<typeof reviewSchema>;

export function sourceInstances(
  readings: ImageReadings,
  source: ReviewSource,
): AnnotationInstance[] | null {
  switch (source) {
    case "review":
      return readings.annotation?.instances ?? null;
    case "proposal":
      return readings.proposal?.document.instances ?? null;
    case "detection":
      return readings.detection
        ? instancesFromDetection(readings.detection)
        : null;
  }
}

export function availableSources(readings: ImageReadings): ReviewSource[] {
  return REVIEW_SOURCES.filter(
    (source) => sourceInstances(readings, source) !== null,
  );
}

function readingSource(readings: ImageReadings): ReviewSource | null {
  return availableSources(readings)[0] ?? null;
}

/**
 * The readings as an agent reads them: every reading as boxes in source
 * pixels, and which one the image reads by. A run names one of these
 * readings as the boxes it begins from.
 */
export function annotationReading(readings: ImageReadings) {
  return {
    ref: readings.ref,
    width: readings.width,
    height: readings.height,
    reading: readingSource(readings),
    review: sourceInstances(readings, "review"),
    proposal: readings.proposal,
    detection: sourceInstances(readings, "detection"),
    progress: readings.progress,
  };
}
