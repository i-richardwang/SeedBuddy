import type { DetectionQuality } from "../../domain/detection/schema";
import type { ImageSplit } from "../../domain/training/schema";
import { m } from "../../paraglide/messages";
import type { StatusTone } from "../../ui/kit/Status";
import type { DatasetImageState } from "./image-state";

const SPLIT_LABELS = {
  train: m.image_split_train,
  val: m.image_split_val,
} as const satisfies Record<ImageSplit, () => string>;

export function splitLabel(split: ImageSplit): string {
  return SPLIT_LABELS[split]();
}

const STATE_LABELS = {
  reviewed: m.reviewed_label,
  proposed: m.ai_proposal_label,
  detected: m.to_review_label,
  unread: m.not_counted_label,
} as const satisfies Record<DatasetImageState, () => string>;

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

const WARNING_LABELS: ReadonlyMap<string, () => string> = new Map([
  ["dish_detection_failed", m.quality_dish_detection_failed],
  ["exposure_clipping", m.quality_exposure_clipping],
  ["low_focus", m.quality_low_focus],
]);

/** Each warning's label, once: warnings this version cannot name share one. */
export function qualityWarningLabels(quality: DetectionQuality): string[] {
  return [
    ...new Set(
      quality.warnings.map(
        (warning) =>
          WARNING_LABELS.get(warning)?.() ?? m.quality_unknown_warning(),
      ),
    ),
  ];
}
