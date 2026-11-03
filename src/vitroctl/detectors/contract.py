from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from vitroctl.contracts.annotation import BoundingBox
from vitroctl.contracts.annotation_set import AnnotatedImage, validate_annotation_set

DETECTION_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class RuntimeDescriptor:
    """Identity of the code/runtime executing an immutable model artifact."""

    adapter: str
    fingerprint: str

    def to_dict(self) -> dict[str, str]:
        return {
            "adapter": self.adapter,
            "fingerprint": self.fingerprint,
        }


@dataclass(frozen=True)
class DetectionProducer:
    """Business model identity plus the exact runtime used for one detection."""

    model_version_id: str
    artifact_digest: str
    runtime: RuntimeDescriptor

    def to_dict(self) -> dict[str, object]:
        return {
            "modelVersionId": self.model_version_id,
            "artifactDigest": self.artifact_digest,
            "runtime": self.runtime.to_dict(),
        }


@dataclass(frozen=True)
class DetectionQuality:
    status: str
    warnings: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, object]:
        return {"status": self.status, "warnings": list(self.warnings)}


@dataclass(frozen=True)
class DetectionInstance:
    instance_id: str
    class_name: str
    bbox: BoundingBox
    score: float

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.instance_id,
            "class": self.class_name,
            "bbox": {
                "x": self.bbox.x,
                "y": self.bbox.y,
                "width": self.bbox.width,
                "height": self.bbox.height,
            },
            "score": self.score,
        }


@dataclass(frozen=True)
class DishGeometry:
    center_x: float
    center_y: float
    radius: float

    def to_dict(self) -> dict[str, float]:
        return {
            "centerX": self.center_x,
            "centerY": self.center_y,
            "radius": self.radius,
        }


@dataclass(frozen=True)
class DetectionDiagnostics:
    dish: DishGeometry | None = None
    metrics: Mapping[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        document: dict[str, object] = {}
        if self.dish is not None:
            document["dish"] = self.dish.to_dict()
        if self.metrics:
            document["metrics"] = dict(self.metrics)
        return document


@dataclass(frozen=True)
class DetectionResult:
    digest: str
    width: int
    height: int
    producer: DetectionProducer
    instances: tuple[DetectionInstance, ...]
    quality: DetectionQuality
    diagnostics: DetectionDiagnostics = field(default_factory=DetectionDiagnostics)

    def __post_init__(self) -> None:
        identifiers: set[str] = set()
        for instance in self.instances:
            if instance.instance_id in identifiers:
                raise ValueError(
                    f"Duplicate detection instance id: {instance.instance_id}"
                )
            identifiers.add(instance.instance_id)
            if (
                instance.bbox.x < 0
                or instance.bbox.y < 0
                or instance.bbox.x + instance.bbox.width > self.width
                or instance.bbox.y + instance.bbox.height > self.height
            ):
                raise ValueError("Detection bounding box exceeds image bounds")

    def require_image(self, digest: str, width: int, height: int) -> None:
        validate_annotation_set(
            (AnnotatedImage(digest, width, height, {"detection": self}),),
            None,
            "detection",
        )

    @classmethod
    def from_document(cls, payload: dict[str, Any]) -> DetectionResult:
        """Build a result from a schema-validated document; its constructor checks bounds and IDs."""
        image = payload["image"]
        producer = _producer(payload["producer"])

        quality = payload["quality"]
        warnings = quality["warnings"]

        return cls(
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

    def to_dict(self) -> dict[str, object]:
        document: dict[str, object] = {
            "schemaVersion": DETECTION_SCHEMA_VERSION,
            "image": {
                "digest": self.digest,
                "width": self.width,
                "height": self.height,
            },
            "producer": self.producer.to_dict(),
            "instances": [instance.to_dict() for instance in self.instances],
            "quality": self.quality.to_dict(),
        }
        diagnostics = self.diagnostics.to_dict()
        if diagnostics:
            document["diagnostics"] = diagnostics
        return document


class Detector(Protocol):
    """An executable model version that emits the canonical detection contract."""

    @property
    def runtime(self) -> RuntimeDescriptor: ...

    @property
    def artifact_digest(self) -> str: ...

    def predict(
        self, image_path: Path, digest: str, producer: DetectionProducer
    ) -> DetectionResult: ...


def adapter_fingerprint(seed: bytes, adapter_file: Path) -> str:
    digest = hashlib.sha256(seed)
    for name in ("../contract.py", "detector.py"):
        digest.update(b"\0")
        digest.update(name.encode())
        digest.update(b"\0")
        digest.update((adapter_file.parent / name).read_bytes())
    return digest.hexdigest()


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
