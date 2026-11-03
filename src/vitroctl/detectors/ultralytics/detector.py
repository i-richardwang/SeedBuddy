from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np

from vitroctl.contracts import annotation
from vitroctl.contracts.annotation import BoundingBox
from vitroctl.contracts.inference import YOLO_IOU
from vitroctl.detectors import contract
from vitroctl.detectors.contract import (
    DetectionInstance,
    DetectionProducer,
    DetectionQuality,
    DetectionResult,
    RuntimeDescriptor,
    adapter_fingerprint,
)
from vitroctl.detectors.ultralytics.runtime import load_yolo


@dataclass(frozen=True)
class YoloInferenceSettings:
    confidence: float
    image_size: int
    max_detections: int
    end_to_end: bool

    @classmethod
    def decode(cls, document: dict[str, Any], context: str) -> YoloInferenceSettings:
        return cls(
            document["confidence"],
            document["imageSize"],
            document["maxDetections"],
            document["endToEnd"],
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "confidence": self.confidence,
            "imageSize": self.image_size,
            "maxDetections": self.max_detections,
            "endToEnd": self.end_to_end,
        }


def ultralytics_runtime_descriptor() -> RuntimeDescriptor:
    """The runtime identity this process would sign YOLO predictions with."""
    return RuntimeDescriptor(
        adapter="ultralytics",
        fingerprint=adapter_fingerprint(
            b"\0ultralytics\0" + version("ultralytics").encode(),
            {
                "contract.py": Path(contract.__file__),
                "annotation.py": Path(annotation.__file__),
                "detector.py": Path(__file__),
            },
        ),
    )


@dataclass
class UltralyticsDetector:
    """Run whole-image inference with the model document's calibrated settings."""

    weights: Path
    settings: YoloInferenceSettings
    class_names: tuple[str, ...]
    device: str | None
    _model: Any = field(default=None, init=False, repr=False)
    _runtime: type = field(init=False, repr=False)
    _artifact_digest: str = field(init=False, repr=False)
    _runtime_descriptor: RuntimeDescriptor = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.weights = self.weights.resolve()
        if not self.weights.is_file():
            raise FileNotFoundError(self.weights)
        self._runtime = load_yolo()
        with self.weights.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256")
        digest.update(b"\0")
        digest.update(
            json.dumps(
                self.settings.to_dict(), sort_keys=True, separators=(",", ":")
            ).encode()
        )
        self._artifact_digest = digest.hexdigest()
        self._runtime_descriptor = ultralytics_runtime_descriptor()

    @property
    def artifact_digest(self) -> str:
        return self._artifact_digest

    @property
    def runtime(self) -> RuntimeDescriptor:
        return self._runtime_descriptor

    def _predictor(self) -> Any:
        if self._model is None:
            model = self._runtime(str(self.weights))
            names = getattr(model, "names", None)
            if isinstance(names, dict) and set(names) == set(range(len(names))):
                artifact_classes = tuple(names[index] for index in range(len(names)))
            else:
                raise RuntimeError("YOLO weights do not declare an ordered class list")
            if artifact_classes != self.class_names:
                raise RuntimeError(
                    "YOLO weight classes differ from the assigned model: "
                    f"{artifact_classes!r} != {self.class_names!r}"
                )
            self._model = model
        return self._model

    def validate_weights(self) -> None:
        """Load weights and verify their declared class ordering before delivery."""
        self._predictor()

    def predict(
        self, image_path: Path, digest: str, producer: DetectionProducer
    ) -> DetectionResult:
        options: dict[str, object] = {
            "source": str(image_path),
            "conf": self.settings.confidence,
            "imgsz": self.settings.image_size,
            "max_det": self.settings.max_detections,
            "end2end": self.settings.end_to_end,
            "iou": YOLO_IOU,
            "verbose": False,
        }
        if self.device is not None:
            options["device"] = self.device
        results = self._predictor().predict(**options)
        if len(results) != 1:
            raise RuntimeError("YOLO must return exactly one result for one image")
        result = results[0]
        height, width = map(int, result.orig_shape)
        instances = []
        if result.boxes is not None:
            boxes = np.asarray(result.boxes.xyxy.cpu().numpy())
            scores = np.asarray(result.boxes.conf.cpu().numpy())
            classes = np.asarray(result.boxes.cls.cpu().numpy())
            if (
                boxes.ndim != 2
                or boxes.shape[1] != 4
                or scores.shape != boxes.shape[:1]
                or classes.shape != boxes.shape[:1]
            ):
                raise RuntimeError("YOLO returned invalid detection boxes")
            for coordinates, score, class_id in zip(
                boxes, scores, classes, strict=True
            ):
                x1, y1, x2, y2 = map(float, coordinates)
                score = float(score)
                numeric_class = float(class_id)
                class_index = int(numeric_class)
                if numeric_class != class_index or not 0 <= class_index < len(
                    self.class_names
                ):
                    raise RuntimeError(
                        f"YOLO returned unknown class index {numeric_class}"
                    )
                left = min(max(x1, 0.0), float(width))
                top = min(max(y1, 0.0), float(height))
                right = min(max(x2, 0.0), float(width))
                bottom = min(max(y2, 0.0), float(height))
                if right <= left or bottom <= top:
                    continue
                instances.append(
                    DetectionInstance(
                        instance_id=str(len(instances)),
                        class_name=self.class_names[class_index],
                        bbox=BoundingBox(left, top, right - left, bottom - top),
                        score=score,
                    )
                )
        return DetectionResult(
            digest=digest,
            width=width,
            height=height,
            producer=producer,
            instances=tuple(instances),
            quality=DetectionQuality("ok"),
        )
