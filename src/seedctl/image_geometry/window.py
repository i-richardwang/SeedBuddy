"""The pixel window a dish coverage frames, shared by training and inference."""

from __future__ import annotations

import math
from dataclasses import dataclass

from seedctl.contracts.annotation import BoundingBox
from seedctl.contracts.coverage import ImageCoverage


@dataclass(frozen=True)
class PixelWindow:
    """A rectangle of whole pixels inside an image, by its top-left corner."""

    x: int
    y: int
    width: int
    height: int

    @classmethod
    def whole(cls, width: int, height: int) -> PixelWindow:
        """The window that is the image itself."""
        return cls(0, 0, width, height)

    @property
    def right(self) -> int:
        return self.x + self.width

    @property
    def bottom(self) -> int:
        return self.y + self.height

    def to_dict(self) -> dict[str, int]:
        return {"x": self.x, "y": self.y, "width": self.width, "height": self.height}

    def crop(self, box: BoundingBox) -> BoundingBox | None:
        """The box in window pixels, clipped to the window; None when outside."""
        left = max(box.x, float(self.x))
        top = max(box.y, float(self.y))
        right = min(box.x + box.width, float(self.right))
        bottom = min(box.y + box.height, float(self.bottom))
        if right <= left or bottom <= top:
            return None
        return BoundingBox(left - self.x, top - self.y, right - left, bottom - top)

    def restore(self, box: BoundingBox) -> BoundingBox:
        """A box found in the window, back in image pixels."""
        return BoundingBox(box.x + self.x, box.y + self.y, box.width, box.height)


def coverage_window(coverage: ImageCoverage, width: int, height: int) -> PixelWindow:
    """The square around the covered dish, in whole pixels and clipped to the
    image. Both runtimes round outward, so no covered pixel is lost."""
    left = max(0, math.floor(coverage.x - coverage.reach))
    top = max(0, math.floor(coverage.y - coverage.reach))
    right = min(width, math.ceil(coverage.x + coverage.reach))
    bottom = min(height, math.ceil(coverage.y + coverage.reach))
    if right <= left or bottom <= top:
        raise ValueError("Dish coverage lies outside the image")
    return PixelWindow(left, top, right - left, bottom - top)
