from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from seedctl.detectors.traditional.config import PipelineConfig
from seedctl.detectors.traditional.detection import detect_seeds
from seedctl.detectors.traditional.scoring import CandidateModel
from seedctl.detectors.traditional.training.data import PreparedImage, match_boxes


@dataclass(frozen=True)
class DetectionMetrics:
    images: int = 0
    truth: int = 0
    predicted: int = 0
    true_positive: int = 0
    false_positive: int = 0
    false_negative: int = 0
    absolute_count_error: int = 0

    @property
    def precision(self) -> float:
        return self.true_positive / max(self.true_positive + self.false_positive, 1)

    @property
    def recall(self) -> float:
        return self.true_positive / max(self.true_positive + self.false_negative, 1)

    @property
    def f1(self) -> float:
        return (
            2.0
            * self.precision
            * self.recall
            / max(self.precision + self.recall, 1e-12)
        )

    @property
    def corrections_per_instance(self) -> float:
        return (self.false_positive + self.false_negative) / max(self.truth, 1)

    def __add__(self, other: DetectionMetrics) -> DetectionMetrics:
        return DetectionMetrics(
            images=self.images + other.images,
            truth=self.truth + other.truth,
            predicted=self.predicted + other.predicted,
            true_positive=self.true_positive + other.true_positive,
            false_positive=self.false_positive + other.false_positive,
            false_negative=self.false_negative + other.false_negative,
            absolute_count_error=self.absolute_count_error + other.absolute_count_error,
        )

    def to_dict(self) -> dict[str, int | float]:
        return {
            "images": self.images,
            "truth": self.truth,
            "predicted": self.predicted,
            "true_positive": self.true_positive,
            "false_positive": self.false_positive,
            "false_negative": self.false_negative,
            "precision": round(self.precision, 6),
            "recall": round(self.recall, 6),
            "f1": round(self.f1, 6),
            "corrections_per_instance": round(self.corrections_per_instance, 6),
            "absolute_count_error": self.absolute_count_error,
        }


@dataclass(frozen=True)
class ProposalMetrics:
    truth: int = 0
    matched: int = 0

    @property
    def recall(self) -> float:
        return self.matched / max(self.truth, 1)

    def __add__(self, other: ProposalMetrics) -> ProposalMetrics:
        return ProposalMetrics(
            truth=self.truth + other.truth,
            matched=self.matched + other.matched,
        )

    def to_dict(self) -> dict[str, int | float]:
        return {
            "truth": self.truth,
            "matched": self.matched,
            "recall": round(self.recall, 6),
        }


def evaluate_proposals(images: Sequence[PreparedImage]) -> ProposalMetrics:
    metrics = ProposalMetrics()
    for image in images:
        metrics += ProposalMetrics(
            truth=len(image.boxes),
            matched=image.matched_boxes,
        )
    return metrics


def evaluate_candidate_model(
    model: CandidateModel,
    images: Sequence[PreparedImage],
    config: PipelineConfig,
) -> DetectionMetrics:
    metrics = DetectionMetrics()
    for image in images:
        detection = detect_seeds(
            list(image.proposals),
            list(image.evidence),
            model,
            config.decision,
        )
        assignments = match_boxes(
            image.boxes,
            [(item.x, item.y) for item in detection.detections],
        )
        truth = len(image.boxes)
        predicted = len(detection.detections)
        true_positive = len(assignments)
        metrics += DetectionMetrics(
            images=1,
            truth=truth,
            predicted=predicted,
            true_positive=true_positive,
            false_positive=predicted - true_positive,
            false_negative=truth - true_positive,
            absolute_count_error=abs(predicted - truth),
        )
    return metrics
