import type { ReviewSource } from "../../domain/annotation/schema";
import { m } from "../../paraglide/messages";
import type { StatusTone } from "../../ui/kit/Status";
import type { Standing } from "./session";

const SOURCE_LABELS: Record<ReviewSource, () => string> = {
  review: m.annotation_source_review,
  proposal: m.annotation_ai_section,
  detection: m.annotation_source_detected,
};

const STANDING_LABELS: Record<
  Standing,
  { tone: StatusTone; label: () => string }
> = {
  edited: { tone: "warning", label: m.annotation_standing_edited },
  reviewed: { tone: "success", label: m.annotation_standing_reviewed },
  proposal: { tone: "info", label: m.annotation_standing_proposal },
  detection: { tone: "info", label: m.annotation_standing_detection },
  unread: { tone: "neutral", label: m.annotation_standing_unread },
};

export function sourceLabel(value: ReviewSource): string {
  return SOURCE_LABELS[value]();
}

export function standingLabel(value: Standing): string {
  return STANDING_LABELS[value].label();
}

export function standingTone(value: Standing): StatusTone {
  return STANDING_LABELS[value].tone;
}
