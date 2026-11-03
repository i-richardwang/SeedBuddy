from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from conftest import PARAMETERS

from vitroctl.detectors.contract import DetectionProducer
from vitroctl.detectors.ultralytics import detector as ultralytics_module
from vitroctl.detectors.ultralytics.detector import (
    UltralyticsDetector,
    YoloInferenceSettings,
)
from vitroctl.worker.model_store import ModelManifest, ModelStore


class _Tensor:
    def __init__(self, values: list[float] | list[list[float]]) -> None:
        self._values = np.asarray(values, dtype=float)

    def cpu(self) -> _Tensor:
        return self

    def numpy(self) -> np.ndarray:
        return self._values


def test_ultralytics_detector_uses_published_inference_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    class FakeYolo:
        def __init__(self, weights: str) -> None:
            self.weights = weights
            self.names = {0: "seed", 1: "germinated"}

        def predict(self, **options: object) -> list[object]:
            calls.append((self.weights, options))
            boxes = SimpleNamespace(
                xyxy=_Tensor(
                    [
                        [-2, 5, 12, 25],
                        [30, 40, 35, 45],
                        [99, 79, 105, 90],
                    ]
                ),
                conf=_Tensor([0.9, 0.8, 0.7]),
                cls=_Tensor([0, 1, 0]),
            )
            return [SimpleNamespace(orig_shape=(80, 100), boxes=boxes)]

    monkeypatch.setattr(ultralytics_module, "load_yolo", lambda: FakeYolo)
    detector = UltralyticsDetector(
        _weights(tmp_path),
        YoloInferenceSettings(0.42, 768, 500, False),
        ("seed", "germinated"),
        device="mps",
    )
    producer = DetectionProducer(
        "set.yolo-v1", detector.artifact_digest, detector.runtime
    )

    result = detector.predict(tmp_path / "source.jpg", "c" * 64, producer)

    assert detector.runtime.adapter == "ultralytics"
    assert result.producer == producer
    assert calls == [
        (
            str(tmp_path / "run" / "weights" / "best.pt"),
            {
                "source": str(tmp_path / "source.jpg"),
                "conf": 0.42,
                "imgsz": 768,
                "max_det": 500,
                "end2end": False,
                "iou": 0.7,
                "verbose": False,
                "device": "mps",
            },
        )
    ]
    assert [instance.to_dict() for instance in result.instances] == [
        {
            "id": "0",
            "class": "seed",
            "bbox": {"x": 0.0, "y": 5.0, "width": 12.0, "height": 20.0},
            "score": 0.9,
        },
        {
            "id": "1",
            "class": "germinated",
            "bbox": {"x": 30.0, "y": 40.0, "width": 5.0, "height": 5.0},
            "score": 0.8,
        },
        {
            "id": "2",
            "class": "seed",
            "bbox": {"x": 99.0, "y": 79.0, "width": 1.0, "height": 1.0},
            "score": 0.7,
        },
    ]


def test_ultralytics_detector_binds_weight_classes_to_the_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeYolo:
        def __init__(self, _weights: str) -> None:
            self.names = {0: "germinated", 1: "seed"}

    monkeypatch.setattr(ultralytics_module, "load_yolo", lambda: FakeYolo)
    detector = UltralyticsDetector(
        _weights(tmp_path),
        YoloInferenceSettings(0.42, 768, 500, False),
        ("seed", "germinated"),
    )
    producer = DetectionProducer(
        "set.yolo-v1", detector.artifact_digest, detector.runtime
    )

    with pytest.raises(RuntimeError, match="weight classes differ"):
        detector.predict(tmp_path / "source.jpg", "c" * 64, producer)


def test_yolo_fingerprint_covers_weights_and_inference_settings(tmp_path: Path) -> None:
    weights = _weights(tmp_path)
    baseline = UltralyticsDetector(
        weights, YoloInferenceSettings(0.42, 768, 500, False), ("seed",)
    )
    changed = UltralyticsDetector(
        weights, YoloInferenceSettings(0.5, 768, 500, False), ("seed",)
    )

    expected = hashlib.sha256(
        b"weights\0"
        + json.dumps(
            baseline.settings.to_dict(), sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()
    assert baseline.artifact_digest == expected
    assert baseline.artifact_digest != changed.artifact_digest
    assert baseline.runtime == changed.runtime


def test_inference_worker_downloads_a_published_yolo_artifact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeYolo:
        def __init__(self, weights: str) -> None:
            self.weights = weights

    monkeypatch.setattr(ultralytics_module, "load_yolo", lambda: FakeYolo)
    reference = UltralyticsDetector(
        _weights(tmp_path), YoloInferenceSettings(0.42, 768, 500, False), ("seed",)
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

        def weights(self, version_id: str) -> bytes:
            self.requested.append(version_id)
            return self.content

    source = Source()
    store = ModelStore(source, tmp_path / "worker", "cpu")

    manifest = ModelManifest.from_document(
        {
            "schemaVersion": 1,
            "modelVersionId": "set.yolo-v1",
            "classes": ["seed"],
            "artifact": artifact,
        }
    )
    deployed = store.load(manifest)

    assert source.requested == ["set.yolo-v1"]
    assert store.load(manifest) is deployed
    assert deployed.artifact_digest == reference.artifact_digest
    weights = tmp_path / "worker/model-artifacts/set.yolo-v1/weights/best.pt"
    assert weights.is_file()

    store.unload()
    weights.write_bytes(b"corrupt")
    repaired = store.load(manifest)

    assert source.requested == ["set.yolo-v1", "set.yolo-v1"]
    assert repaired.artifact_digest == reference.artifact_digest
    assert weights.read_bytes() == b"weights"

    store.unload()
    weights.write_bytes(b"corrupt")
    source.content = b"WEIGHTS"
    with pytest.raises(ValueError, match="unexpected digest"):
        store.load(manifest)


def _weights(tmp_path: Path) -> Path:
    weights = tmp_path / "run" / "weights" / "best.pt"
    weights.parent.mkdir(parents=True)
    weights.write_bytes(b"weights")
    return weights
