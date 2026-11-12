from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from seedctl.detectors.traditional.candidates import (
    CandidateEvidence,
    describe_candidates,
)
from seedctl.detectors.traditional.config import (
    PipelineConfig,
)
from seedctl.detectors.traditional.detection import CandidateSelection, detect_seeds
from seedctl.detectors.traditional.geometry import DishRegions, estimate_geometry
from seedctl.detectors.traditional.identity import ExecutionIdentity
from seedctl.detectors.traditional.normalization import (
    NormalizedImage,
    normalize_image,
)
from seedctl.detectors.traditional.proposals import SeedProposal, propose_seed_centers
from seedctl.detectors.traditional.regions import render_regions
from seedctl.detectors.traditional.rendering import render_debug, render_overlay
from seedctl.detectors.traditional.results import CountResult, QualityReport
from seedctl.detectors.traditional.scoring import CandidateModel
from seedctl.io.files import file_digest
from seedctl.io.image_io import read_image


@dataclass(frozen=True)
class CandidateAnalysis:
    image: np.ndarray
    geometry: DishRegions
    normalized: NormalizedImage
    proposals: list[SeedProposal]
    evidence: list[CandidateEvidence]


def analyze_candidates(
    path: str | Path,
    config: PipelineConfig,
) -> CandidateAnalysis:
    image = read_image(path)
    geometry = estimate_geometry(image, config)
    normalized = normalize_image(image, geometry.reference_mask, geometry.radius)
    proposals = propose_seed_centers(
        normalized,
        geometry.reference_mask,
        geometry.search_mask,
        geometry.radius,
        config.proposals,
    )
    evidence = describe_candidates(
        normalized,
        proposals,
        geometry.center,
        geometry.radius,
    )
    return CandidateAnalysis(
        image=image,
        geometry=geometry,
        normalized=normalized,
        proposals=proposals,
        evidence=evidence,
    )


def _assess_quality(
    geometry: DishRegions,
    normalized: NormalizedImage,
    config: PipelineConfig,
) -> QualityReport:
    warnings: list[str] = []
    if geometry.used_fallback:
        warnings.append("dish_detection_failed")
    if normalized.clipped_fraction > config.quality.maximum_clipped_fraction:
        warnings.append("exposure_clipping")
    if normalized.focus_score < config.quality.minimum_focus_score:
        warnings.append("low_focus")
    return QualityReport(
        status="review_required" if warnings else "ok",
        warnings=tuple(warnings),
        clipped_fraction=normalized.clipped_fraction,
        focus_score=normalized.focus_score,
    )


@dataclass(frozen=True)
class Recognition:
    """A counted image together with the intermediates its views are drawn from."""

    result: CountResult
    image: np.ndarray
    geometry: DishRegions
    normalized: NormalizedImage
    detection: CandidateSelection
    regions: np.ndarray

    def overlay(self) -> np.ndarray:
        return render_overlay(self.image, self.geometry, self.detection, self.regions)

    def debug(self) -> np.ndarray:
        return render_debug(
            self.image, self.geometry, self.normalized, self.detection, self.regions
        )


def recognize(
    image_path: str | Path,
    *,
    config: PipelineConfig,
    model: CandidateModel,
) -> Recognition:
    analysis = analyze_candidates(image_path, config)
    image = analysis.image
    geometry = analysis.geometry
    normalized = analysis.normalized
    detection = detect_seeds(
        analysis.proposals,
        analysis.evidence,
        model,
        config.decision,
    )
    window_radius = max(
        3, round(geometry.radius * config.rendering.region_radius_fraction)
    )
    regions = render_regions(image.shape[:2], detection.detections, window_radius)
    result = CountResult(
        path=Path(image_path),
        digest=file_digest(image_path),
        width=image.shape[1],
        height=image.shape[0],
        detections=detection.detections,
        dish_center=geometry.center,
        dish_radius=geometry.radius,
        execution=ExecutionIdentity.create(config, model),
        quality=_assess_quality(geometry, normalized, config),
    )
    return Recognition(result, image, geometry, normalized, detection, regions)


def count_seeds(
    image_path: str | Path,
    *,
    config: PipelineConfig,
    model: CandidateModel,
) -> CountResult:
    return recognize(image_path, config=config, model=model).result
