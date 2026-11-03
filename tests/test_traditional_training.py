from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from vitroctl.contracts.annotation import (
    AnnotationDocument,
    AnnotationInstance,
    BoundingBox,
)
from vitroctl.detectors.traditional.candidates import FEATURE_NAMES, CandidateEvidence
from vitroctl.detectors.traditional.config import DecisionConfig, PipelineConfig
from vitroctl.detectors.traditional.proposals import SeedProposal
from vitroctl.detectors.traditional.scoring import CandidateModel
from vitroctl.detectors.traditional.training.data import (
    PreparedImage,
    label_candidates,
    match_boxes,
    prepare_images,
)
from vitroctl.detectors.traditional.training.evaluation import evaluate_candidate_model
from vitroctl.detectors.traditional.training.training import (
    SelectionGrid,
    train_candidate_model,
)


def _evidence(response: float) -> CandidateEvidence:
    return CandidateEvidence(
        response=response,
        contrast=0.0,
        chroma=0.0,
        support=0.0,
        finite_support=0.0,
        continuation=0.0,
        texture=0.0,
        surface_distance=0.0,
        elongation=0.0,
        persistence=0.0,
        rim_clearance=0.0,
    )


def _prior() -> CandidateModel:
    return CandidateModel(
        name="prior",
        feature_names=FEATURE_NAMES,
        means=(0.0,) * len(FEATURE_NAMES),
        scales=(1.0,) * len(FEATURE_NAMES),
        weights=(0.0,) * len(FEATURE_NAMES),
        bias=0.0,
    )


def _image(index: int) -> PreparedImage:
    annotation = AnnotationDocument(
        digest=f"{index:064x}",
        width=100,
        height=100,
        instances=(
            AnnotationInstance("seed-1", "ungerminated", BoundingBox(5, 5, 10, 10)),
        ),
    )
    return PreparedImage(
        annotation=annotation,
        boxes=(BoundingBox(5, 5, 10, 10),),
        proposals=(
            SeedProposal(10, 10, 4, 1, 1),
            SeedProposal(50, 50, 4, 1, 1),
        ),
        evidence=(_evidence(2.0), _evidence(-2.0)),
        labels=np.asarray([1, 0], dtype=np.int64),
        matched_boxes=1,
    )


def test_box_matching_is_one_to_one() -> None:
    boxes = [BoundingBox(0, 0, 10, 10), BoundingBox(4, 0, 10, 10)]
    assignments = match_boxes(boxes, [(6, 5)])
    assert len(assignments) == 1
    assert set(assignments.values()) == {0}


def test_box_matching_maximizes_the_number_of_instances() -> None:
    boxes = [BoundingBox(0, 0, 10, 10), BoundingBox(4, 4, 2, 2)]
    assignments = match_boxes(boxes, [(5, 5), (1, 1)])
    assert assignments == {0: 1, 1: 0}


def test_every_candidate_inside_an_instance_is_positive() -> None:
    proposals = [
        SeedProposal(4, 5, 2, 1, 1),
        SeedProposal(6, 5, 4, 1, 1),
        SeedProposal(20, 20, 2, 1, 1),
    ]
    labels = label_candidates([BoundingBox(0, 0, 10, 10)], proposals)
    assert labels.tolist() == [1, 1, 0]


def test_every_annotated_class_is_a_seed_body(monkeypatch: pytest.MonkeyPatch) -> None:
    data = "vitroctl.detectors.traditional.training.data"
    monkeypatch.setattr(f"{data}.verified_blob", lambda root, digest: Path(digest))
    monkeypatch.setattr(
        f"{data}.analyze_candidates",
        lambda path, config: SimpleNamespace(
            image=np.zeros((100, 100, 3), dtype=np.uint8),
            proposals=[SeedProposal(10, 10, 4, 1, 1), SeedProposal(50, 50, 4, 1, 1)],
            evidence=[_evidence(1.0), _evidence(1.0)],
        ),
    )
    annotation = AnnotationDocument(
        digest="0" * 64,
        width=100,
        height=100,
        instances=(
            AnnotationInstance("a", "ungerminated", BoundingBox(5, 5, 10, 10)),
            AnnotationInstance("b", "germinated", BoundingBox(45, 45, 10, 10)),
        ),
    )

    [prepared] = prepare_images([annotation], "data", PipelineConfig())

    assert prepared.labels.tolist() == [1, 1]
    assert prepared.matched_boxes == 2


def test_training_selects_a_model_that_reduces_traditional_corrections() -> None:
    images = [_image(index) for index in range(3)]
    config = PipelineConfig(
        decision=DecisionConfig(
            confidence_threshold=0.5,
            duplicate_distance_scale=1.0,
        )
    )
    baseline = evaluate_candidate_model(_prior(), images, config)

    trained = train_candidate_model(
        images,
        _prior(),
        config,
        grid=SelectionGrid((None, 1.0), (0.3, 3.0), (0.3, 0.5, 0.7)),
    )

    assert baseline.false_positive == 3
    assert trained.report.cross_validation.false_positive == 0
    assert trained.report.cross_validation.false_negative == 0
    assert trained.report.training.corrections_per_instance == 0
    assert trained.config.decision.confidence_threshold == 0.5
    assert (
        trained.report.selection.threshold
        == trained.config.decision.confidence_threshold
    )
    assert trained.report.selection.bandwidth is None
    assert not trained.model.calibration_centers
    assert trained.model.fingerprint != _prior().fingerprint
