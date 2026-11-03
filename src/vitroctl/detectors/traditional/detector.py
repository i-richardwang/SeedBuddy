from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from vitroctl.contracts.annotation import BoundingBox
from vitroctl.detectors.contract import (
    DetectionDiagnostics,
    DetectionInstance,
    DetectionProducer,
    DetectionQuality,
    DetectionResult,
    DishGeometry,
    RuntimeDescriptor,
    adapter_fingerprint,
)
from vitroctl.detectors.traditional.config import PipelineConfig
from vitroctl.detectors.traditional.identity import ExecutionIdentity
from vitroctl.detectors.traditional.pipeline import count_seeds
from vitroctl.detectors.traditional.scoring import CandidateModel

#: Every body the detector finds is a seed it cannot yet judge as germinated.
TRADITIONAL_CLASS = "ungerminated"

_BOX_SIDE_FRACTION = 0.025
_MIN_BOX_SIZE = 2.0


def _artifact_digest(execution: ExecutionIdentity) -> str:
    config = json.dumps(
        execution.config.to_dict(),
        sort_keys=True,
        separators=(",", ":"),
    )
    identity = f"{execution.model_fingerprint}\0{config}".encode()
    return hashlib.sha256(identity).hexdigest()


def _box_around(
    x: float,
    y: float,
    side: float,
    image_width: int,
    image_height: int,
) -> BoundingBox | None:
    left = max(0.0, min(x - side / 2.0, image_width))
    top = max(0.0, min(y - side / 2.0, image_height))
    right = max(0.0, min(x + side / 2.0, image_width))
    bottom = max(0.0, min(y + side / 2.0, image_height))
    width = right - left
    height = bottom - top
    if width < _MIN_BOX_SIZE or height < _MIN_BOX_SIZE:
        return None
    return BoundingBox(left, top, width, height)


@dataclass(frozen=True)
class TraditionalDetector:
    config: PipelineConfig
    model: CandidateModel

    @property
    def artifact_digest(self) -> str:
        execution = ExecutionIdentity.create(self.config, self.model)
        return _artifact_digest(execution)

    @property
    def runtime(self) -> RuntimeDescriptor:
        execution = ExecutionIdentity.create(self.config, self.model)
        return RuntimeDescriptor(
            adapter="traditional",
            fingerprint=adapter_fingerprint(
                execution.pipeline_fingerprint.encode(), Path(__file__)
            ),
        )

    def predict(
        self, image_path: Path, digest: str, producer: DetectionProducer
    ) -> DetectionResult:
        result = count_seeds(image_path, config=self.config, model=self.model)
        side = result.dish_radius * _BOX_SIDE_FRACTION
        instances = []
        for detection in result.detections:
            bbox = _box_around(
                detection.x,
                detection.y,
                side,
                result.width,
                result.height,
            )
            if bbox is not None:
                instances.append(
                    DetectionInstance(
                        instance_id=str(detection.detection_id),
                        class_name=TRADITIONAL_CLASS,
                        bbox=bbox,
                        score=detection.score,
                    )
                )
        return DetectionResult(
            digest=digest,
            width=result.width,
            height=result.height,
            producer=producer,
            instances=tuple(instances),
            quality=DetectionQuality(
                status=result.quality.status,
                warnings=result.quality.warnings,
            ),
            diagnostics=DetectionDiagnostics(
                dish=DishGeometry(
                    center_x=result.dish_center[0],
                    center_y=result.dish_center[1],
                    radius=result.dish_radius,
                ),
                metrics={
                    "confidence_threshold": self.config.decision.confidence_threshold,
                    "clipped_fraction": round(result.quality.clipped_fraction, 6),
                    "focus_score": round(result.quality.focus_score, 3),
                },
            ),
        )
