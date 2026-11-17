from __future__ import annotations

import hashlib
import json
from dataclasses import astuple
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest
from conftest import encoded_image

from seedctl.contracts.coverage import ImageCoverage
from seedctl.detectors.contract import DetectionProducer
from seedctl.detectors.ultralytics import detector as ultralytics_module
from seedctl.detectors.ultralytics.detector import (
    UltralyticsDetector,
    YoloInferenceSettings,
)


class _Tensor:
    def __init__(self, values: list[float] | list[list[float]]) -> None:
        self._values = np.asarray(values, dtype=float)

    def cpu(self) -> _Tensor:
        return self

    def numpy(self) -> np.ndarray:
        return self._values


def _fake_yolo(calls: list[dict[str, Any]], boxes: list[list[float]]) -> type:
    class FakeYolo:
        def __init__(self, weights: str) -> None:
            self.weights = weights
            self.names = {0: "seed", 1: "germinated"}

        def predict(self, **options: object) -> list[object]:
            calls.append(options)
            source = options["source"]
            assert isinstance(source, np.ndarray)
            found = SimpleNamespace(
                xyxy=_Tensor(boxes),
                conf=_Tensor([0.9, 0.8, 0.7][: len(boxes)]),
                cls=_Tensor([0.0, 1.0, 0.0][: len(boxes)]),
            )
            return [SimpleNamespace(orig_shape=source.shape[:2], boxes=found)]

    return FakeYolo


def _source(tmp_path: Path, width: int = 100, height: int = 80) -> Path:
    source = tmp_path / "source.avif"
    source.write_bytes(encoded_image(width, height))
    return source


def test_yolo_detector_uses_published_inference_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(
        ultralytics_module,
        "load_yolo",
        lambda: _fake_yolo(
            calls,
            [
                [-2.0, 5.0, 12.0, 25.0],
                [30.0, 40.0, 35.0, 45.0],
                [99.0, 79.0, 105.0, 90.0],
            ],
        ),
    )
    detector = UltralyticsDetector(
        _weights(tmp_path),
        YoloInferenceSettings(0.42, 100, 500, False, "whole_image"),
        ("seed", "germinated"),
        device="mps",
    )
    producer = DetectionProducer(
        "set.yolo-v1", detector.artifact_digest, detector.runtime
    )

    result = detector.predict(_source(tmp_path), "c" * 64, producer, None)

    assert detector.runtime.adapter == "ultralytics"
    assert result.producer == producer
    assert (result.width, result.height) == (100, 80)
    [options] = calls
    assert options.pop("source").shape == (80, 100, 3)
    assert options == {
        "conf": 0.42,
        "imgsz": 100,
        "max_det": 500,
        "end2end": False,
        "iou": 0.7,
        "verbose": False,
        "device": "mps",
    }
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
    assert "diagnostics" not in result.to_dict()


def test_dish_version_reads_the_covered_frame_and_answers_in_image_pixels(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(
        ultralytics_module,
        "load_yolo",
        lambda: _fake_yolo(calls, [[-3.0, 2.0, 10.0, 12.0], [40.0, 30.0, 70.0, 50.0]]),
    )
    detector = UltralyticsDetector(
        _weights(tmp_path),
        YoloInferenceSettings(0.42, 184, 500, False, "dish"),
        ("seed", "germinated"),
        device=None,
    )
    producer = DetectionProducer(
        "set.yolo-v1", detector.artifact_digest, detector.runtime
    )
    source = _source(tmp_path, 200, 160)
    coverage = ImageCoverage(x=120.0, y=80.0, radius=40.0, margin=0.15)

    framed = detector.predict(source, "c" * 64, producer, coverage)

    # The dish reaches 46px from (120, 80): x 74..166, y 34..126, rounded out,
    # and is read at twice its size.
    [options] = calls
    assert options["source"].shape == (184, 184, 3)
    assert (framed.width, framed.height) == (200, 160)
    assert [astuple(instance.bbox) for instance in framed.instances] == [
        pytest.approx((74.0, 35.0, 5.0, 5.0)),
        pytest.approx((94.0, 49.0, 15.0, 10.0)),
    ]
    assert framed.to_dict()["diagnostics"] == {
        "dish": {"centerX": 120.0, "centerY": 80.0, "radius": 40.0}
    }

    # Without coverage the dish version reads the whole image, as the
    # snapshot it was trained on did for an image whose dish was not found.
    whole = detector.predict(source, "c" * 64, producer, None)
    assert calls[-1]["source"].shape == (148, 184, 3)
    assert astuple(whole.instances[0].bbox) == pytest.approx(
        (0.0, 2.0 * 160 / 148, 10.0 * 200 / 184, 10.0 * 160 / 148)
    )
    assert "diagnostics" not in whole.to_dict()


def test_a_tiled_version_answers_once_for_what_neighbouring_tiles_both_find(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[dict[str, Any]] = []
    # Every tile finds one object near its left edge and one near its right.
    monkeypatch.setattr(
        ultralytics_module,
        "load_yolo",
        lambda: _fake_yolo(calls, [[4.0, 4.0, 12.0, 12.0], [50.0, 4.0, 58.0, 12.0]]),
    )
    detector = UltralyticsDetector(
        _weights(tmp_path),
        YoloInferenceSettings(0.42, 100, 500, False, "whole_image", 64),
        ("seed", "germinated"),
        device=None,
    )
    producer = DetectionProducer(
        "set.yolo-v1", detector.artifact_digest, detector.runtime
    )

    result = detector.predict(_source(tmp_path, 100, 64), "c" * 64, producer, None)

    # Tiles start at x 0 and 36 and meet at 50. The left tile's second object
    # is centred at 54 and the right tile's first at 44: each is the other's.
    assert [call["source"].shape for call in calls] == [(64, 64, 3)] * 2
    assert {call["imgsz"] for call in calls} == {64}
    assert [astuple(instance.bbox) for instance in result.instances] == [
        (4.0, 4.0, 8.0, 8.0),
        (86.0, 4.0, 8.0, 8.0),
    ]
    assert [instance.instance_id for instance in result.instances] == ["0", "1"]


def test_whole_image_version_refuses_a_frame(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ultralytics_module, "load_yolo", lambda: _fake_yolo([], []))
    detector = UltralyticsDetector(
        _weights(tmp_path),
        YoloInferenceSettings(0.42, 768, 500, False, "whole_image"),
        ("seed", "germinated"),
        device=None,
    )
    producer = DetectionProducer(
        "set.yolo-v1", detector.artifact_digest, detector.runtime
    )
    with pytest.raises(ValueError, match="whole_image version reads no dish"):
        detector.predict(
            _source(tmp_path),
            "c" * 64,
            producer,
            ImageCoverage(50.0, 40.0, 30.0, 0.15),
        )
    with pytest.raises(ValueError, match="Unknown inference mode"):
        YoloInferenceSettings(0.42, 768, 500, False, "panorama")  # type: ignore[arg-type]


def test_yolo_detector_binds_weight_classes_to_the_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeYolo:
        def __init__(self, _weights: str) -> None:
            self.names = {0: "germinated", 1: "seed"}

    monkeypatch.setattr(ultralytics_module, "load_yolo", lambda: FakeYolo)
    detector = UltralyticsDetector(
        _weights(tmp_path),
        YoloInferenceSettings(0.42, 768, 500, False, "whole_image"),
        ("seed", "germinated"),
        device=None,
    )
    producer = DetectionProducer(
        "set.yolo-v1", detector.artifact_digest, detector.runtime
    )

    with pytest.raises(RuntimeError, match="weight classes differ"):
        detector.predict(_source(tmp_path), "c" * 64, producer, None)


def test_yolo_fingerprint_covers_weights_and_inference_settings(tmp_path: Path) -> None:
    weights = _weights(tmp_path)
    baseline = UltralyticsDetector(
        weights,
        YoloInferenceSettings(0.42, 768, 500, False, "whole_image"),
        ("seed",),
        device=None,
    )
    changed = UltralyticsDetector(
        weights,
        YoloInferenceSettings(0.5, 768, 500, False, "whole_image"),
        ("seed",),
        device=None,
    )
    framed = UltralyticsDetector(
        weights,
        YoloInferenceSettings(0.42, 768, 500, False, "dish"),
        ("seed",),
        device=None,
    )

    expected = hashlib.sha256(
        b"weights\0"
        + json.dumps(
            baseline.settings.to_dict(), sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()
    assert baseline.artifact_digest == expected
    assert baseline.artifact_digest != changed.artifact_digest
    # A version that reads its frames whole states no tile size.
    assert "tileSize" not in baseline.settings.to_dict()
    tiled = UltralyticsDetector(
        weights,
        YoloInferenceSettings(0.42, 768, 500, False, "whole_image", 384),
        ("seed",),
        device=None,
    )
    assert tiled.settings.to_dict()["tileSize"] == 384
    assert tiled.artifact_digest != baseline.artifact_digest
    # The frame is recorded on the version, not hashed into its weights.
    assert framed.artifact_digest == baseline.artifact_digest
    assert baseline.runtime == changed.runtime


def _weights(tmp_path: Path) -> Path:
    weights = tmp_path / "run" / "weights" / "best.pt"
    weights.parent.mkdir(parents=True)
    weights.write_bytes(b"weights")
    return weights
