import type { CultureEventType } from "../../domain/experiments/culture-events";
import type {
  Exclusion,
  ReviewState,
} from "../../domain/experiments/read-model";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import type { SummaryMeasure } from "../../domain/experiments/summary";
import { m } from "../../paraglide/messages";
import { formatDay } from "../../ui/Day";
import type { StatusTone } from "../../ui/kit/Status";

/** An observation is named by the day it was made. */
export function observationLabel(observation: ExperimentObservation): string {
  return formatDay(observation.observedOn);
}

/** The number a summary reads a day by, named. */
export function summaryMeasureLabel(measure: SummaryMeasure): string {
  return SUMMARY_MEASURE_LABELS[measure]();
}

const CULTURE_EVENT_LABELS = {
  contaminated: m.culture_event_contaminated,
  nonviable: m.culture_event_nonviable,
  discarded: m.culture_event_discarded,
  harvested: m.culture_event_harvested,
  missing: m.culture_event_missing,
} as const satisfies Record<CultureEventType, () => string>;

export function cultureEventLabel(type: CultureEventType): string {
  return CULTURE_EVENT_LABELS[type]();
}

const IMAGE_REVIEW_LABELS = {
  reviewed: { tone: "success", label: m.reviewed_label },
  unreviewed: { tone: "neutral", label: m.to_review_label },
} as const satisfies Record<
  ReviewState,
  { tone: StatusTone; label: () => string }
>;

export function imageReviewLabel(value: ReviewState): string {
  return IMAGE_REVIEW_LABELS[value].label();
}

export function imageReviewTone(value: ReviewState): StatusTone {
  return IMAGE_REVIEW_LABELS[value].tone;
}

const SUMMARY_MEASURE_LABELS = {
  rate: m.summary_measure_rate,
  count: m.summary_measure_count,
} as const satisfies Record<SummaryMeasure, () => string>;

export function exclusionNote(exclusion: Exclusion): string {
  return exclusion.reason === "unclear"
    ? m.experiment_cell_excluded_unclear()
    : m.experiment_cell_excluded_event();
}

export function exclusionLabel(exclusion: Exclusion): string {
  return exclusion.reason === "event"
    ? cultureEventLabel(exclusion.event.type)
    : m.unclear_label();
}
