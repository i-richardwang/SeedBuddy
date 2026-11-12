from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from seedctl.contracts.annotation import AnnotationDocument, BoundingBox
from seedctl.datasets.geometry import require_image_dimensions
from seedctl.datasets.manifest import verified_blob
from seedctl.detectors.traditional.candidates import FEATURE_NAMES, CandidateEvidence
from seedctl.detectors.traditional.config import PipelineConfig
from seedctl.detectors.traditional.pipeline import analyze_candidates
from seedctl.detectors.traditional.proposals import SeedProposal


@dataclass(frozen=True)
class PreparedImage:
    annotation: AnnotationDocument
    boxes: tuple[BoundingBox, ...]
    proposals: tuple[SeedProposal, ...]
    evidence: tuple[CandidateEvidence, ...]
    labels: np.ndarray
    matched_boxes: int

    @property
    def features(self) -> np.ndarray:
        if not self.evidence:
            return np.empty((0, len(FEATURE_NAMES)), dtype=np.float64)
        return np.vstack([item.to_array() for item in self.evidence])


def match_boxes(
    boxes: Sequence[BoundingBox], points: Sequence[tuple[float, float]]
) -> dict[int, int]:
    neighbors: list[list[tuple[float, int]]] = []
    for box in boxes:
        center_x, center_y = box.center
        half_width = box.width / 2.0
        half_height = box.height / 2.0
        candidates: list[tuple[float, int]] = []
        for point_index, (x, y) in enumerate(points):
            if not box.contains(x, y):
                continue
            distance = ((x - center_x) / half_width) ** 2 + (
                (y - center_y) / half_height
            ) ** 2
            candidates.append((distance, point_index))
        neighbors.append(sorted(candidates))

    point_assignments: dict[int, int] = {}

    def assign(box_index: int, visited: set[int]) -> bool:
        for _, point_index in neighbors[box_index]:
            if point_index in visited:
                continue
            visited.add(point_index)
            previous = point_assignments.get(point_index)
            if previous is None or assign(previous, visited):
                point_assignments[point_index] = box_index
                return True
        return False

    order = sorted(range(len(boxes)), key=lambda index: len(neighbors[index]))
    for box_index in order:
        assign(box_index, set())
    return {
        box_index: point_index for point_index, box_index in point_assignments.items()
    }


def label_candidates(
    boxes: Sequence[BoundingBox], proposals: Sequence[SeedProposal]
) -> np.ndarray:
    return np.asarray(
        [
            int(any(box.contains(proposal.x, proposal.y) for box in boxes))
            for proposal in proposals
        ],
        dtype=np.int64,
    )


def _prepare_image(
    annotation: AnnotationDocument,
    data_root: str | Path,
    config: PipelineConfig,
) -> PreparedImage:
    boxes = tuple(instance.bbox for instance in annotation.instances)
    analysis = analyze_candidates(verified_blob(data_root, annotation.digest), config)
    require_image_dimensions(
        analysis.image.shape, annotation.width, annotation.height, annotation.digest
    )
    proposals = tuple(analysis.proposals)
    assignments = match_boxes(
        boxes,
        [(proposal.x, proposal.y) for proposal in proposals],
    )
    return PreparedImage(
        annotation=annotation,
        boxes=boxes,
        proposals=proposals,
        evidence=tuple(analysis.evidence),
        labels=label_candidates(boxes, proposals),
        matched_boxes=len(assignments),
    )


def prepare_images(
    annotations: Iterable[AnnotationDocument],
    data_root: str | Path,
    config: PipelineConfig,
) -> list[PreparedImage]:
    return [_prepare_image(annotation, data_root, config) for annotation in annotations]
