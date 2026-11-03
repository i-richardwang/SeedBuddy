from __future__ import annotations

from typing import Any

from vitroctl.contracts.annotation import BoundingBox
from vitroctl.contracts.validation import validate_wire_contract
from vitroctl.detectors.contract import (
    DetectionDiagnostics,
    DetectionInstance,
    DetectionProducer,
    DetectionQuality,
    DetectionResult,
    DishGeometry,
    RuntimeDescriptor,
)


def _runtime(descriptor: dict[str, Any]) -> RuntimeDescriptor:
    return RuntimeDescriptor(
        adapter=descriptor["adapter"],
        fingerprint=descriptor["fingerprint"],
    )


def _producer(producer: dict[str, Any]) -> DetectionProducer:
    return DetectionProducer(
        model_version_id=producer["modelVersionId"],
        artifact_digest=producer["artifactDigest"],
        runtime=_runtime(producer["runtime"]),
    )


def _diagnostics(diagnostics: dict[str, Any]) -> DetectionDiagnostics:
    dish = None
    if "dish" in diagnostics:
        raw_dish = diagnostics["dish"]
        dish = DishGeometry(
            center_x=raw_dish["centerX"],
            center_y=raw_dish["centerY"],
            radius=raw_dish["radius"],
        )
    return DetectionDiagnostics(dish=dish, metrics=dict(diagnostics.get("metrics", {})))


def _instance(instance: dict[str, Any]) -> DetectionInstance:
    raw_bbox = instance["bbox"]
    return DetectionInstance(
        instance_id=instance["id"],
        class_name=instance["class"],
        bbox=BoundingBox(
            x=raw_bbox["x"],
            y=raw_bbox["y"],
            width=raw_bbox["width"],
            height=raw_bbox["height"],
        ),
        score=instance["score"],
    )


def parse_detection_result(value: Any, context: str = "detection") -> DetectionResult:
    validate_wire_contract("detection-result", value, context)
    return detection_from_document(value)


def detection_from_document(payload: dict[str, Any]) -> DetectionResult:
    """Build a result from a schema-validated document; its constructor checks bounds and IDs."""
    image = payload["image"]
    producer = _producer(payload["producer"])

    quality = payload["quality"]
    warnings = quality["warnings"]

    return DetectionResult(
        digest=image["digest"],
        width=image["width"],
        height=image["height"],
        producer=producer,
        instances=tuple(_instance(raw) for raw in payload["instances"]),
        quality=DetectionQuality(
            status=quality["status"],
            warnings=tuple(warnings),
        ),
        diagnostics=(
            _diagnostics(payload["diagnostics"])
            if "diagnostics" in payload
            else DetectionDiagnostics()
        ),
    )
