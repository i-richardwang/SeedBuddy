"""Box annotations: the canonical training data of a dataset."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from vitroctl.contracts.validation import validate_wire_contract

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
    def from_document(cls, payload: dict[str, Any], context: str) -> AnnotationDocument:
        """Read a schema-validated document and check image-relative semantics."""
        image = payload["image"]
        digest = image["digest"]
        image_width = image["width"]
        image_height = image["height"]

        return cls(
            digest=digest,
            width=image_width,
            height=image_height,
            instances=_parse_instances(
                payload["instances"], image_width, image_height, f"{context}.instances"
            ),
        )

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


def _parse_box(
    value: dict[str, Any], image_width: int, image_height: int, context: str
) -> BoundingBox:
    parsed = BoundingBox(
        x=value["x"],
        y=value["y"],
        width=value["width"],
        height=value["height"],
    )
    if (
        parsed.x < 0
        or parsed.y < 0
        or parsed.x + parsed.width > image_width
        or parsed.y + parsed.height > image_height
    ):
        raise ValueError(f"{context} exceeds image bounds")
    return parsed


def _parse_instances(
    value: Any, image_width: int, image_height: int, context: str
) -> tuple[AnnotationInstance, ...]:
    identifiers: set[str] = set()
    instances: list[AnnotationInstance] = []
    for index, instance in enumerate(value):
        instance_context = f"{context}[{index}]"
        identifier = instance["id"]
        if identifier in identifiers:
            raise ValueError(f"{instance_context}.id is a duplicate: {identifier}")
        identifiers.add(identifier)
        class_name = instance["class"]
        instances.append(
            AnnotationInstance(
                instance_id=identifier,
                class_name=class_name,
                bbox=_parse_box(
                    instance["bbox"],
                    image_width,
                    image_height,
                    f"{instance_context}.bbox",
                ),
            )
        )
    return tuple(instances)


def parse_annotation(value: Any, context: str = "annotation") -> AnnotationDocument:
    validate_wire_contract("annotation", value, context)
    return AnnotationDocument.from_document(value, context)
