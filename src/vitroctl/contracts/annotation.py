"""Box annotations: the canonical training data of a dataset."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

ANNOTATION_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class BoundingBox:
    x: float
    y: float
    width: float
    height: float

    @property
    def center(self) -> tuple[float, float]:
        return self.x + self.width / 2.0, self.y + self.height / 2.0

    def contains(self, x: float, y: float) -> bool:
        return (
            self.x <= x <= self.x + self.width and self.y <= y <= self.y + self.height
        )


@dataclass(frozen=True)
class AnnotationInstance:
    instance_id: str
    class_name: str
    bbox: BoundingBox


@dataclass(frozen=True)
class AnnotationDocument:
    digest: str
    width: int
    height: int
    instances: tuple[AnnotationInstance, ...]

    @classmethod
    def decode(cls, payload: dict[str, Any], context: str) -> AnnotationDocument:
        image = payload["image"]
        instances = tuple(
            AnnotationInstance(raw["id"], raw["class"], BoundingBox(**raw["bbox"]))
            for raw in payload["instances"]
        )
        validate_instances(instances, image["width"], image["height"], context)
        return cls(image["digest"], image["width"], image["height"], instances)

    def to_dict(self) -> dict[str, object]:
        return {
            "schemaVersion": ANNOTATION_SCHEMA_VERSION,
            "image": {
                "digest": self.digest,
                "width": self.width,
                "height": self.height,
            },
            "instances": [
                {
                    "id": instance.instance_id,
                    "class": instance.class_name,
                    "bbox": {
                        "x": instance.bbox.x,
                        "y": instance.bbox.y,
                        "width": instance.bbox.width,
                        "height": instance.bbox.height,
                    },
                }
                for instance in self.instances
            ],
        }


class BoxInstance(Protocol):
    @property
    def instance_id(self) -> str: ...

    @property
    def bbox(self) -> BoundingBox: ...


def validate_instances(
    instances: Sequence[BoxInstance], width: int, height: int, context: str
) -> None:
    """Check instance identities and pixel bounds after wire decoding."""
    identifiers: set[str] = set()
    for index, instance in enumerate(instances):
        location = f"{context}.instances[{index}]"
        if instance.instance_id in identifiers:
            raise ValueError(f"{location}.id is a duplicate: {instance.instance_id}")
        identifiers.add(instance.instance_id)
        box = instance.bbox
        if (
            box.x < 0
            or box.y < 0
            or box.x + box.width > width
            or box.y + box.height > height
        ):
            raise ValueError(f"{location}.bbox exceeds image bounds")
