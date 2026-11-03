/**
 * Where an image of a dataset stands: reviewed, drawn by an agent and
 * waiting for review, detected and waiting for review, or not yet detected.
 * A later stage outranks an earlier one.
 */
export type DatasetImageState = "reviewed" | "proposed" | "detected" | "unread";

export const DATASET_IMAGE_STATES: readonly DatasetImageState[] = [
  "reviewed",
  "proposed",
  "detected",
  "unread",
];

export function datasetImageState(image: {
  reviewCount: number | null;
  proposalCount: number | null;
  detectionCount: number | null;
}): DatasetImageState {
  if (image.reviewCount !== null) return "reviewed";
  if (image.proposalCount !== null) return "proposed";
  if (image.detectionCount !== null) return "detected";
  return "unread";
}
