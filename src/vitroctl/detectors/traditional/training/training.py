from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace

import numpy as np

from vitroctl.detectors.traditional.config import PipelineConfig
from vitroctl.detectors.traditional.scoring import CandidateModel, radial_kernel
from vitroctl.detectors.traditional.training.data import PreparedImage
from vitroctl.detectors.traditional.training.evaluation import (
    DetectionMetrics,
    ProposalMetrics,
    evaluate_candidate_model,
    evaluate_proposals,
)


@dataclass(frozen=True)
class SelectionGrid:
    bandwidths: tuple[float | None, ...]
    regularizations: tuple[float, ...]
    thresholds: tuple[float, ...]


_DEFAULT_GRID = SelectionGrid(
    (None, 1.0, 2.0, 3.0),
    (0.3, 1.0, 3.0, 10.0, 30.0),
    tuple(float(value) for value in np.linspace(0.30, 0.95, 27)),
)
_MAXIMUM_CALIBRATION_CENTERS = 128
_CALIBRATION_TARGET_LOGIT = 2.0


@dataclass(frozen=True)
class ModelSelection:
    bandwidth: float | None
    regularization: float
    threshold: float
    metrics: DetectionMetrics

    def to_dict(self) -> dict[str, object]:
        return {
            "calibration_bandwidth": self.bandwidth,
            "regularization": self.regularization,
            "confidence_threshold": self.threshold,
            "metrics": self.metrics.to_dict(),
        }


@dataclass(frozen=True)
class TrainingReport:
    image_count: int
    proposal: ProposalMetrics
    baseline: DetectionMetrics
    cross_validation: DetectionMetrics
    training: DetectionMetrics
    selection: ModelSelection
    selections: tuple[ModelSelection, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "images": self.image_count,
            "proposal": self.proposal.to_dict(),
            "baseline": self.baseline.to_dict(),
            "cross_validation": self.cross_validation.to_dict(),
            "training": self.training.to_dict(),
            "selected": {
                "calibration_bandwidth": self.selection.bandwidth,
                "regularization": self.selection.regularization,
                "confidence_threshold": self.selection.threshold,
            },
            "selections": [selection.to_dict() for selection in self.selections],
        }


@dataclass(frozen=True)
class CandidateModelTraining:
    model: CandidateModel
    config: PipelineConfig
    report: TrainingReport


def _training_arrays(images: Sequence[PreparedImage]) -> tuple[np.ndarray, np.ndarray]:
    populated = [image for image in images if len(image.labels)]
    if not populated:
        raise ValueError("Candidate model training requires candidate proposals")
    features = np.vstack([image.features for image in populated])
    labels = np.concatenate([image.labels for image in populated])
    if set(np.unique(labels)) != {0, 1}:
        raise ValueError(
            "Candidate model training requires seed and background candidates"
        )
    return features, labels


def _balanced_weights(labels: np.ndarray) -> np.ndarray:
    positives = max(int(np.sum(labels == 1)), 1)
    negatives = max(int(np.sum(labels == 0)), 1)
    return np.where(labels == 1, 0.5 / positives, 0.5 / negatives) * len(labels)


def _calibration_indices(
    residuals: np.ndarray,
    labels: np.ndarray,
    maximum: int,
) -> np.ndarray:
    selected: list[int] = []
    quota = maximum // 2
    for label in (0, 1):
        candidates = np.flatnonzero(labels == label)
        ranked = candidates[np.argsort(-np.abs(residuals[candidates]), kind="stable")]
        selected.extend(int(index) for index in ranked[:quota])
    if len(selected) < maximum:
        remaining = np.setdiff1d(
            np.arange(len(labels)),
            np.asarray(selected, dtype=np.int64),
            assume_unique=True,
        )
        ranked = remaining[np.argsort(-np.abs(residuals[remaining]), kind="stable")]
        selected.extend(int(index) for index in ranked[: maximum - len(selected)])
    return np.asarray(selected, dtype=np.int64)


def _fit_candidate_model(
    images: Sequence[PreparedImage],
    prior: CandidateModel,
    bandwidth: float | None,
    regularization: float,
) -> CandidateModel:
    features, labels = _training_arrays(images)
    normalized = np.clip(
        (features - np.asarray(prior.means)) / np.asarray(prior.scales),
        -6.0,
        6.0,
    )
    design = np.column_stack([normalized, np.ones(len(normalized))])
    parameters = np.asarray((*prior.weights, prior.bias), dtype=np.float64)
    prior_parameters = parameters.copy()
    sample_weights = _balanced_weights(labels)
    penalty = np.eye(design.shape[1], dtype=np.float64)
    penalty[-1, -1] = 0.25

    for _ in range(40):
        logits = np.clip(design @ parameters, -30.0, 30.0)
        probabilities = 1.0 / (1.0 + np.exp(-logits))
        variance = np.maximum(probabilities * (1.0 - probabilities), 1e-5)
        working_response = logits + (labels - probabilities) / variance
        weights = sample_weights * variance
        system = (design.T * weights) @ design + regularization * penalty
        target = (
            design.T @ (weights * working_response)
            + regularization * penalty @ prior_parameters
        )
        updated = np.linalg.solve(system, target)
        if np.linalg.norm(updated - parameters) <= 1e-7 * (
            1.0 + np.linalg.norm(parameters)
        ):
            parameters = updated
            break
        parameters = updated

    if bandwidth is None:
        return CandidateModel(
            name="candidate-seedness",
            feature_names=prior.feature_names,
            means=prior.means,
            scales=prior.scales,
            weights=tuple(float(value) for value in parameters[:-1]),
            bias=float(parameters[-1]),
        )

    linear_logits = design @ parameters
    target_logits = np.where(
        labels == 1,
        _CALIBRATION_TARGET_LOGIT,
        -_CALIBRATION_TARGET_LOGIT,
    )
    residuals = target_logits - linear_logits
    center_indices = _calibration_indices(
        residuals,
        labels,
        min(_MAXIMUM_CALIBRATION_CENTERS, len(labels)),
    )
    centers = normalized[center_indices]
    kernel = radial_kernel(normalized, centers, bandwidth)
    system = (kernel.T * sample_weights) @ kernel + regularization * np.eye(
        len(centers)
    )
    target = kernel.T @ (sample_weights * residuals)
    calibration_weights = np.linalg.solve(system, target)

    return CandidateModel(
        name="candidate-seedness",
        feature_names=prior.feature_names,
        means=prior.means,
        scales=prior.scales,
        weights=tuple(float(value) for value in parameters[:-1]),
        bias=float(parameters[-1]),
        calibration_centers=tuple(
            tuple(float(value) for value in center) for center in centers
        ),
        calibration_weights=tuple(float(value) for value in calibration_weights),
        calibration_bandwidth=bandwidth,
    )


def _config_with_threshold(config: PipelineConfig, threshold: float) -> PipelineConfig:
    return replace(
        config,
        decision=replace(config.decision, confidence_threshold=threshold),
    )


def _metrics_key(metrics: DetectionMetrics) -> tuple[float, ...]:
    return (
        metrics.corrections_per_instance,
        -metrics.recall,
        -metrics.precision,
    )


def _selection_key(selection: ModelSelection) -> tuple[float, ...]:
    return (
        *_metrics_key(selection.metrics),
        float(selection.bandwidth is not None),
        -(selection.bandwidth or 0.0),
        -selection.regularization,
    )


def _cross_validate(
    images: Sequence[PreparedImage],
    prior: CandidateModel,
    config: PipelineConfig,
    bandwidth: float | None,
    regularization: float,
    thresholds: Sequence[float],
) -> ModelSelection:
    metrics = {threshold: DetectionMetrics() for threshold in thresholds}
    for index, validation in enumerate(images):
        training = [image for offset, image in enumerate(images) if offset != index]
        model = _fit_candidate_model(
            training,
            prior,
            bandwidth,
            regularization,
        )
        for threshold in thresholds:
            metrics[threshold] += evaluate_candidate_model(
                model,
                [validation],
                _config_with_threshold(config, threshold),
            )
    selections = tuple(
        ModelSelection(
            bandwidth=bandwidth,
            regularization=regularization,
            threshold=threshold,
            metrics=result,
        )
        for threshold, result in metrics.items()
    )
    best_metrics = min(_metrics_key(selection.metrics) for selection in selections)
    best = [
        selection
        for selection in selections
        if _metrics_key(selection.metrics) == best_metrics
    ]
    midpoint = (
        min(selection.threshold for selection in best)
        + max(selection.threshold for selection in best)
    ) / 2.0
    return min(
        best,
        key=lambda selection: (
            abs(selection.threshold - midpoint),
            selection.threshold,
        ),
    )


def train_candidate_model(
    images: Sequence[PreparedImage],
    prior: CandidateModel,
    config: PipelineConfig,
    grid: SelectionGrid = _DEFAULT_GRID,
) -> CandidateModelTraining:
    bandwidths, regularizations, thresholds = (
        grid.bandwidths,
        grid.regularizations,
        grid.thresholds,
    )
    if len(images) < 2:
        raise ValueError(
            "Candidate model selection requires at least two complete images"
        )
    if not bandwidths or not regularizations or not thresholds:
        raise ValueError("Candidate model selection requires parameter values")
    if any(value is not None and value <= 0 for value in bandwidths):
        raise ValueError("Calibration bandwidths must be positive")
    if any(value <= 0 for value in regularizations):
        raise ValueError("Regularization values must be positive")
    if any(not 0 <= value <= 1 for value in thresholds):
        raise ValueError("Confidence thresholds must be between 0 and 1")

    selections = tuple(
        _cross_validate(
            images,
            prior,
            config,
            bandwidth,
            regularization,
            thresholds,
        )
        for bandwidth in bandwidths
        for regularization in regularizations
    )
    selected = min(selections, key=_selection_key)
    selected_config = _config_with_threshold(config, selected.threshold)
    model = _fit_candidate_model(
        images,
        prior,
        selected.bandwidth,
        selected.regularization,
    )
    report = TrainingReport(
        image_count=len(images),
        proposal=evaluate_proposals(images),
        baseline=evaluate_candidate_model(prior, images, config),
        cross_validation=selected.metrics,
        training=evaluate_candidate_model(model, images, selected_config),
        selection=selected,
        selections=selections,
    )
    return CandidateModelTraining(
        model=model,
        config=selected_config,
        report=report,
    )
