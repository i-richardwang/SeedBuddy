import hashlib
from pathlib import Path

import cv2
import numpy as np
import pytest

from vitroctl.detectors.traditional.candidates import (
    FEATURE_NAMES,
    CandidateEvidence,
    describe_candidates,
)
from vitroctl.detectors.traditional.config import (
    DEFAULT_PIPELINE_CONFIG,
    DecisionConfig,
    PipelineConfig,
)
from vitroctl.detectors.traditional.detection import detect_seeds
from vitroctl.detectors.traditional.geometry import circle_mask
from vitroctl.detectors.traditional.normalization import (
    NormalizedImage,
    normalize_image,
)
from vitroctl.detectors.traditional.pipeline import count_seeds, recognize
from vitroctl.detectors.traditional.proposals import SeedProposal, propose_seed_centers
from vitroctl.detectors.traditional.scoring import (
    DEFAULT_MODEL,
    CandidateModel,
    load_candidate_model,
    write_candidate_model,
)


def _evidence(response: float) -> CandidateEvidence:
    return CandidateEvidence(
        response=response,
        contrast=0.0,
        chroma=0.0,
        support=0.0,
        finite_support=0.0,
        continuation=2.0,
        texture=2.0,
        surface_distance=2.0,
        elongation=1.0,
        persistence=0.0,
        rim_clearance=0.0,
    )


def _response_model() -> CandidateModel:
    return CandidateModel(
        name="test",
        feature_names=FEATURE_NAMES,
        means=(0.0,) * len(FEATURE_NAMES),
        scales=(1.0,) * len(FEATURE_NAMES),
        weights=(1.0,) + (0.0,) * (len(FEATURE_NAMES) - 1),
        bias=0.0,
    )


def test_normalization_uses_reference_region_statistics() -> None:
    image = np.full((500, 500, 3), 170, dtype=np.uint8)
    reference = circle_mask(image.shape[:2], (250, 250), 120)
    changed = image.copy()
    changed[~reference] = (20, 240, 20)

    original = normalize_image(image, reference, 200)
    modified = normalize_image(changed, reference, 200)

    inner = circle_mask(image.shape[:2], (250, 250), 80)
    assert np.allclose(original.lightness[inner], modified.lightness[inner])
    assert np.allclose(original.warm_chroma[inner], modified.warm_chroma[inner])


def test_proposals_cover_the_search_region() -> None:
    shape = (400, 400)
    lightness = np.zeros(shape, dtype=np.float32)
    cv2.circle(lightness, (200, 200), 6, 8.0, -1)
    cv2.circle(lightness, (320, 200), 6, 8.0, -1)
    normalized = NormalizedImage(
        lightness=lightness,
        red=np.zeros(shape, dtype=np.float32),
        yellow=np.zeros(shape, dtype=np.float32),
        surface_distance=np.zeros(shape, dtype=np.float32),
        clipped_fraction=0.0,
        focus_score=100.0,
    )
    reference = circle_mask(shape, (200, 200), 100)
    search = circle_mask(shape, (200, 200), 150)

    proposals = propose_seed_centers(
        normalized,
        reference,
        search,
        170,
        PipelineConfig().proposals,
    )

    assert any(np.hypot(item.x - 320, item.y - 200) < 10 for item in proposals)


def test_candidate_evidence_is_finite_for_degenerate_shape_support() -> None:
    shape = (41, 41)
    lightness = np.zeros(shape, dtype=np.float32)
    lightness[20, 20] = 10.0
    normalized = NormalizedImage(
        lightness=lightness,
        red=np.zeros(shape, dtype=np.float32),
        yellow=np.zeros(shape, dtype=np.float32),
        surface_distance=np.zeros(shape, dtype=np.float32),
        clipped_fraction=0.0,
        focus_score=100.0,
    )

    evidence = describe_candidates(
        normalized,
        [SeedProposal(20, 20, 4, 1, 1)],
        (20, 20),
        20,
    )[0]

    assert np.all(np.isfinite(evidence.to_array()))
    assert evidence.elongation == 0.0


def test_confidence_threshold_selects_candidates() -> None:
    proposals = [SeedProposal(10, 10, 5, 1, 1), SeedProposal(30, 10, 5, 1, 1)]
    result = detect_seeds(
        proposals,
        [_evidence(2.0), _evidence(-2.0)],
        _response_model(),
        DecisionConfig(confidence_threshold=0.7),
    )

    assert [(seed.x, seed.y) for seed in result.detections] == [(10, 10)]


def test_candidate_model_requires_its_canonical_schema() -> None:
    payload = DEFAULT_MODEL.to_dict()
    assert CandidateModel.from_dict(payload) == DEFAULT_MODEL

    payload.pop("calibration_bandwidth")
    with pytest.raises(ValueError, match="schema"):
        CandidateModel.from_dict(payload)

    payload = DEFAULT_MODEL.to_dict()
    payload["weights"] = "invalid"
    with pytest.raises(ValueError, match="weights must be an array"):
        CandidateModel.from_dict(payload)

    payload = DEFAULT_MODEL.to_dict()
    weights = payload["weights"]
    assert isinstance(weights, list)
    weights[0] = "1.0"
    with pytest.raises(ValueError, match="weights must be numeric"):
        CandidateModel.from_dict(payload)


def test_candidate_model_file_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "model.json"
    write_candidate_model(DEFAULT_MODEL, path)

    assert load_candidate_model(path) == DEFAULT_MODEL


def test_count_seeds_records_the_image_identity(tmp_path: Path) -> None:
    path = tmp_path / "downloaded.jpg"
    cv2.imwrite(str(path), np.zeros((400, 600, 3), dtype=np.uint8))

    result = count_seeds(path, config=DEFAULT_PIPELINE_CONFIG, model=DEFAULT_MODEL)

    assert result.path == path
    assert result.digest == hashlib.sha256(path.read_bytes()).hexdigest()
    assert result.to_dict()["image"]["digest"] == result.digest
    assert list(tmp_path.iterdir()) == [path]


def test_duplicate_response_keeps_the_stronger_candidate() -> None:
    proposals = [SeedProposal(10, 10, 5, 1, 1), SeedProposal(14, 10, 5, 1, 1)]
    result = detect_seeds(
        proposals,
        [_evidence(3.0), _evidence(2.0)],
        _response_model(),
        DecisionConfig(confidence_threshold=0.5, duplicate_distance_scale=1.5),
    )

    assert len(result.detections) == 1
    assert (result.detections[0].x, result.detections[0].y) == (10, 10)


def test_unrecognizable_dish_requires_review(tmp_path: Path) -> None:
    path = tmp_path / "blank.jpg"
    cv2.imwrite(str(path), np.zeros((400, 600, 3), dtype=np.uint8))

    recognition = recognize(path, config=DEFAULT_PIPELINE_CONFIG, model=DEFAULT_MODEL)
    result = recognition.result
    payload = result.to_dict()

    assert result.count == 0
    assert payload["pipeline"]["name"] == result.execution.pipeline_name
    assert payload["pipeline"]["fingerprint"] == result.execution.pipeline_fingerprint
    assert len(result.execution.pipeline_fingerprint) == 64
    assert payload["model"]["name"] == result.execution.model_name
    assert payload["model"]["fingerprint"] == result.execution.model_fingerprint
    assert result.quality.status == "review_required"
    assert "dish_detection_failed" in result.quality.warnings
    assert recognition.geometry.dish_mask.shape == (400, 600)
    assert recognition.regions.shape == (400, 600)
    assert recognition.overlay().shape == (400, 600, 3)
