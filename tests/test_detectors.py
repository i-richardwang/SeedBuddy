import json
import math
from pathlib import Path
from types import SimpleNamespace

import pytest

from vitroctl.contracts.annotation import BoundingBox
from vitroctl.contracts.validation import validate_wire_contract
from vitroctl.detectors.contract import (
    DetectionInstance,
    DetectionProducer,
    DetectionQuality,
    DetectionResult,
    RuntimeDescriptor,
)
from vitroctl.detectors.traditional.config import DecisionConfig, PipelineConfig
from vitroctl.detectors.traditional.detector import TraditionalDetector
from vitroctl.detectors.traditional.scoring import DEFAULT_MODEL

CONTRACT_FIXTURE = Path(__file__).parent / "fixtures" / "contracts" / "detection.json"
PRODUCER = DetectionProducer(
    model_version_id="set.traditional-v1",
    artifact_digest="a" * 64,
    runtime=RuntimeDescriptor(adapter="traditional", fingerprint="b" * 64),
)


def test_traditional_manifest_matches_the_default_artifact() -> None:
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "configs/traditional-v1.json").read_text())
    assert manifest == {
        "schemaVersion": 1,
        "definition": "traditional-v1",
        "createdAt": "2026-08-27T00:00:00.000Z",
        "artifactDigest": TraditionalDetector().artifact_digest,
    }


def test_shared_detection_contract() -> None:
    document = DetectionResult(
        digest="c" * 64,
        width=100,
        height=80,
        producer=PRODUCER,
        instances=(
            DetectionInstance("seed-1", "seed", BoundingBox(10, 20, 8, 6), 0.9),
        ),
        quality=DetectionQuality("ok"),
    ).to_dict()
    fixture = json.loads(CONTRACT_FIXTURE.read_text(encoding="utf-8"))
    assert document == fixture
    assert DetectionResult.from_document(fixture).to_dict() == fixture


def test_parser_rejects_unknown_contract_fields() -> None:
    document = json.loads(CONTRACT_FIXTURE.read_text(encoding="utf-8"))
    document["unexpected"] = True
    with pytest.raises(ValueError, match="detection.*shared contract"):
        validate_wire_contract("detection-result", document, "detection")


def test_traditional_detector_adapts_detections_to_boxes(monkeypatch) -> None:
    config = PipelineConfig()
    detector = TraditionalDetector(config, DEFAULT_MODEL)
    producer = DetectionProducer(
        "set.traditional-v1", detector.artifact_digest, detector.runtime
    )
    result = SimpleNamespace(
        width=100,
        height=80,
        dish_radius=200.0,
        dish_center=(50.0, 40.0),
        detections=[SimpleNamespace(detection_id=3, x=10.0, y=12.0, score=0.91)],
        quality=SimpleNamespace(
            status="ok", warnings=(), clipped_fraction=0.01, focus_score=20.0
        ),
    )
    monkeypatch.setattr(
        "vitroctl.detectors.traditional.detector.count_seeds",
        lambda *args, **kwargs: result,
    )

    document = detector.predict(Path("a.jpg"), "c" * 64, producer).to_dict()

    assert document["schemaVersion"] == 1
    assert document["image"] == {"digest": "c" * 64, "width": 100, "height": 80}
    assert document["producer"] == producer.to_dict()
    assert document["instances"] == [
        {
            "id": "3",
            "class": "ungerminated",
            "bbox": {"x": 7.5, "y": 9.5, "width": 5.0, "height": 5.0},
            "score": 0.91,
        }
    ]
    assert document["diagnostics"] == {
        "dish": {"centerX": 50.0, "centerY": 40.0, "radius": 200.0},
        "metrics": {
            "confidence_threshold": config.decision.confidence_threshold,
            "clipped_fraction": 0.01,
            "focus_score": 20.0,
        },
    }


def test_traditional_artifact_identity_covers_model_and_configuration() -> None:
    baseline = TraditionalDetector()
    changed = TraditionalDetector(
        PipelineConfig(decision=DecisionConfig(confidence_threshold=0.5)),
        DEFAULT_MODEL,
    )
    assert changed.artifact_digest != baseline.artifact_digest
    assert changed.runtime.adapter == baseline.runtime.adapter == "traditional"


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        (
            {"quality": {"status": "unknown", "warnings": []}},
            "quality.status.*shared contract",
        ),
        (
            {"quality": {"status": "ok", "warnings": ["Not A Code"]}},
            r"quality.warnings\[0\].*shared contract",
        ),
        (
            {
                "instances": [
                    DetectionInstance(
                        "seed", "seed", BoundingBox(0, 0, 1, 1), math.inf
                    ).to_dict()
                ]
            },
            r"instances\[0\].score must be finite",
        ),
        (
            {
                "instances": [
                    DetectionInstance(
                        "seed", "seed", BoundingBox(0, 0, 1, 1), 1.1
                    ).to_dict()
                ]
            },
            r"instances\[0\].score.*shared contract",
        ),
        (
            {"image": {"digest": "images/set/example.jpg", "width": 100, "height": 80}},
            "image.digest.*shared contract",
        ),
    ],
)
def test_contract_rejects_values_the_web_cannot_accept(change, reason) -> None:
    document = json.loads(CONTRACT_FIXTURE.read_text())
    with pytest.raises(ValueError, match=reason):
        validate_wire_contract("detection-result", {**document, **change}, "detection")


def test_result_rejects_duplicate_ids_and_out_of_bounds_boxes() -> None:
    outside = DetectionInstance("seed-1", "seed", BoundingBox(95, 20, 8, 6), 0.9)
    with pytest.raises(ValueError, match="exceeds image bounds"):
        DetectionResult(
            "c" * 64,
            100,
            80,
            PRODUCER,
            (outside,),
            DetectionQuality("ok"),
        )

    instance = DetectionInstance("seed-1", "seed", BoundingBox(10, 20, 8, 6), 0.9)
    with pytest.raises(ValueError, match="Duplicate"):
        DetectionResult(
            "c" * 64,
            100,
            80,
            PRODUCER,
            (instance, instance),
            DetectionQuality("ok"),
        )


def test_execution_failure_is_not_a_detection_document() -> None:
    failure = {
        "schemaVersion": 1,
        "image": {"digest": "c" * 64},
        "producer": PRODUCER.to_dict(),
        "error": "transport failed",
    }
    with pytest.raises(ValueError, match="shared contract"):
        validate_wire_contract("detection-result", failure, "detection")


@pytest.mark.parametrize(
    ("digest", "width", "height", "reason"),
    [
        ("d" * 64, 100, 80, "describes another image"),
        ("c" * 64, 101, 80, "dimensions differ"),
        ("c" * 64, 100, 81, "dimensions differ"),
    ],
)
def test_detection_must_describe_the_source_image(digest, width, height, reason):
    fixture = json.loads(CONTRACT_FIXTURE.read_text())
    result = DetectionResult.from_document(fixture)
    with pytest.raises(ValueError, match=reason):
        result.require_image(digest, width, height)
    result.require_image("c" * 64, 100, 80)
