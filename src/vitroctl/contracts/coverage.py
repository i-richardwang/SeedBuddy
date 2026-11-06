"""The dish an image is framed to, as the workbench froze it."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Literal

#: Where a model looks: the whole photograph, or the culture dish each
#: image's analysis found, which its images are framed to.
ModelArea = Literal["image", "dish"]
MODEL_AREAS: tuple[ModelArea, ...] = ("image", "dish")


@dataclass(frozen=True)
class ImageCoverage:
    """The dish circle the workbench's analysis found, kept with a margin of
    its radius. Training crops an image to the square around it, inference
    reads the same square, and every box stays in canonical image pixels."""

    x: float
    y: float
    radius: float
    margin: float

    @classmethod
    def decode(cls, value: Any, context: str) -> ImageCoverage:
        if value["kind"] != "dish":
            raise ValueError(f"{context}.kind must be dish")
        circle = value["circle"]
        return cls(circle["x"], circle["y"], circle["radius"], value["margin"])

    @property
    def reach(self) -> float:
        """How far the covered dish extends from its centre, margin included."""
        return self.radius * (1.0 + self.margin)

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": "dish",
            "circle": {"x": self.x, "y": self.y, "radius": self.radius},
            "margin": self.margin,
        }


def decode_coverage(value: Any, context: str) -> ImageCoverage | None:
    return None if value is None else ImageCoverage.decode(value, context)


def validate_framing(
    area: ModelArea, coverages: Iterable[ImageCoverage | None], context: str
) -> None:
    """Only a ``dish`` area frames images; an ``image`` area carries none."""
    if area == "image" and any(coverage is not None for coverage in coverages):
        raise ValueError(f"{context} frames an image to a dish under an image area")
