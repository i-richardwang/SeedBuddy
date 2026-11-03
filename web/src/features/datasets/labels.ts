import type { ImageSplit } from "../../domain/training/schema";
import { m } from "../../paraglide/messages";
import type { StatusTone } from "../../ui/kit/Status";

const SPLIT_LABELS: Record<ImageSplit, () => string> = {
  train: m.image_split_train,
  val: m.image_split_val,
};

export function splitLabel(split: ImageSplit): string {
  return SPLIT_LABELS[split]();
}

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

const STATE_LABELS: Record<DatasetImageState, () => string> = {
  reviewed: m.dataset_state_reviewed,
  proposed: m.dataset_state_proposed,
  detected: m.dataset_state_detected,
  unread: m.dataset_state_unread,
};

export function datasetImageStateLabel(state: DatasetImageState): string {
  return STATE_LABELS[state]();
}

const DATASET_IMAGE_STATE_TONE = {
  reviewed: "success",
  proposed: "info",
  detected: "warning",
  unread: "neutral",
} as const satisfies Record<DatasetImageState, StatusTone>;

export function datasetImageStateTone(state: DatasetImageState): StatusTone {
  return DATASET_IMAGE_STATE_TONE[state];
}
