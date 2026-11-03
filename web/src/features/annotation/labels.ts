import type { ReviewSource } from "../../domain/annotation/schema";
import { m } from "../../paraglide/messages";
import type { StatusTone } from "../../ui/kit/Status";
import type { LayerKey } from "./layers";
import type { Standing } from "./session";

const SOURCE_LABELS = {
  review: m.annotation_source_review,
  proposal: m.ai_proposal_label,
  detection: m.annotation_source_detected,
} as const satisfies Record<ReviewSource, () => string>;

const STANDING_LABELS = {
  edited: { tone: "warning", label: m.annotation_standing_edited },
  reviewed: { tone: "success", label: m.reviewed_label },
  proposal: { tone: "info", label: m.annotation_standing_proposal },
  detection: { tone: "info", label: m.annotation_standing_detection },
  unread: { tone: "neutral", label: m.annotation_standing_unread },
} as const satisfies Record<
  Standing,
  { tone: StatusTone; label: () => string }
>;

export function sourceLabel(value: ReviewSource): string {
  return SOURCE_LABELS[value]();
}

export function standingLabel(value: Standing): string {
  return STANDING_LABELS[value].label();
}

export function standingTone(value: Standing): StatusTone {
  return STANDING_LABELS[value].tone;
}

const LAYER_LABELS = {
  boxes: m.annotation_layer_boxes,
  ids: m.annotation_layer_ids,
  checks: m.annotation_ai_checks,
} as const satisfies Record<LayerKey, () => string>;

export function layerLabel(layer: LayerKey): string {
  return LAYER_LABELS[layer]();
}
