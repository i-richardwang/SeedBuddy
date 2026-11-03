from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from conftest import PARAMETERS, decode_model_manifest

from vitroctl.detectors.ultralytics import detector as ultralytics_module
from vitroctl.detectors.ultralytics.detector import (
    UltralyticsDetector,
    YoloInferenceSettings,
)
from vitroctl.worker.model_store import ModelStore


def test_inference_worker_downloads_a_published_yolo_artifact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeYolo:
        def __init__(self, weights: str) -> None:
            self.weights = weights

    monkeypatch.setattr(ultralytics_module, "load_yolo", lambda: FakeYolo)
    reference = UltralyticsDetector(
        _weights(tmp_path),
        YoloInferenceSettings(0.42, 768, 500, False),
        ("seed",),
        device=None,
    )
    artifact = {
        "kind": "ultralytics",
        "digest": reference.artifact_digest,
        "weights": {
            "digest": hashlib.sha256(b"weights").hexdigest(),
            "bytes": len(b"weights"),
        },
        "inference": {
            "confidence": 0.42,
            "imageSize": 768,
            "maxDetections": 500,
            "endToEnd": False,
        },
        "validation": {
            "precision": 0.6,
            "recall": 0.5,
            "map50": 0.7,
            "map50To95": 0.4,
            "fitness": 0.43,
        },
        "training": {
            "baseModel": {
                "reference": "yolo26n.pt",
                "digest": "a" * 64,
            },
            "parameters": PARAMETERS,
            "runtime": {
                "framework": "ultralytics",
                "version": "8.4.131",
            },
        },
    }

    class Source:
        def __init__(self) -> None:
            self.requested: list[str] = []
            self.content = b"weights"

        def weights(self, version_id: str, deadline: float) -> bytes:
            self.requested.append(version_id)
            return self.content

    source = Source()
    store = ModelStore(source, tmp_path / "worker", "cpu")

    manifest = decode_model_manifest(
        {
            "schemaVersion": 1,
            "modelVersionId": "set.yolo-v1",
            "classes": ["seed"],
            "artifact": artifact,
        }
    )
    deployed = store.load(manifest, 123.0)

    assert source.requested == ["set.yolo-v1"]
    assert store.load(manifest, 123.0) is deployed
    assert deployed.artifact_digest == reference.artifact_digest
    weights = tmp_path / "worker/model-artifacts/set.yolo-v1/weights/best.pt"
    assert weights.is_file()

    store.unload()
    weights.write_bytes(b"corrupt")
    repaired = store.load(manifest, 123.0)

    assert source.requested == ["set.yolo-v1", "set.yolo-v1"]
    assert repaired.artifact_digest == reference.artifact_digest
    assert weights.read_bytes() == b"weights"

    store.unload()
    weights.write_bytes(b"corrupt")
    source.content = b"WEIGHTS"
    with pytest.raises(ValueError, match="Content failed digest verification"):
        store.load(manifest, 123.0)


def _weights(tmp_path: Path) -> Path:
    weights = tmp_path / "run" / "weights" / "best.pt"
    weights.parent.mkdir(parents=True)
    weights.write_bytes(b"weights")
    return weights
