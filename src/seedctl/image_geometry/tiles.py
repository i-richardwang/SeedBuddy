"""How a frame is read: scaled to one resolution, through overlapping tiles.

Training, validation and inference share this geometry, so a version reads
its frames the way it was trained on them. A frame no larger than a tile is
one tile: the whole frame.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

import cv2
import numpy as np

from seedctl.image_geometry.window import PixelWindow

#: The least share of a tile's side it has in common with its neighbour. An
#: object no wider than that lies whole in the tile that answers for it.
TILE_OVERLAP = 0.25


@dataclass(frozen=True)
class Tile:
    """A tile of a scaled frame and the part of the frame it answers for.

    Cores partition the frame: an object belongs to the tile whose core holds
    its centre, and what a tile finds outside its core is its neighbour's.
    """

    window: PixelWindow
    core: PixelWindow

    def owns(self, x: Any, y: Any) -> Any:
        """Whether this tile answers for an object centred at a frame point:
        one, or each of an array of them."""
        return self.core.holds(x, y)


def _spans(length: int, tile: int) -> list[tuple[int, int, int, int]]:
    """(origin, extent, core origin, core extent) of each tile along a side:
    evenly spaced, with seams midway through each overlap."""
    if length <= tile:
        return [(0, length, 0, length)]
    count = math.ceil((length - tile) / (tile - math.ceil(tile * TILE_OVERLAP))) + 1
    origins = [round(index * (length - tile) / (count - 1)) for index in range(count)]
    seams = [
        0,
        *((left + right + tile) // 2 for left, right in pairwise(origins)),
        length,
    ]
    return [
        (origin, tile, start, end - start)
        for origin, (start, end) in zip(origins, pairwise(seams), strict=True)
    ]


@dataclass(frozen=True)
class Tiling:
    """A frame scaled so its longer side is ``resolution`` pixels, read through
    square tiles of ``tile`` pixels a side."""

    resolution: int
    tile: int

    @classmethod
    def reading(cls, resolution: int, tile: int | None) -> Tiling:
        """Frames read at a resolution through tiles of a stated side: whole
        when none is stated, or one no smaller than the resolution."""
        return cls(resolution, resolution if tile is None else min(tile, resolution))

    def size(self, width: int, height: int) -> tuple[int, int]:
        """The width and height a frame of the given size is read at."""
        ratio = self.resolution / max(width, height)
        return (
            min(math.ceil(width * ratio), self.resolution),
            min(math.ceil(height * ratio), self.resolution),
        )

    def scale(self, frame: np.ndarray) -> np.ndarray:
        """A frame's pixels at the resolution it is read at."""
        height, width = frame.shape[:2]
        size = self.size(width, height)
        if size == (width, height):
            return frame
        return cv2.resize(frame, size, interpolation=cv2.INTER_LINEAR)

    def tiles(self, width: int, height: int) -> tuple[Tile, ...]:
        """Every tile of a scaled frame, row by row."""
        return tuple(
            Tile(
                PixelWindow(x, y, tile_width, tile_height),
                PixelWindow(core_x, core_y, core_width, core_height),
            )
            for y, tile_height, core_y, core_height in _spans(height, self.tile)
            for x, tile_width, core_x, core_width in _spans(width, self.tile)
        )

    def passes(self, width: int, height: int) -> int:
        """How many tiles cover a scaled frame's area once."""
        return math.ceil(width / self.tile) * math.ceil(height / self.tile)

    def draw(self, width: int, height: int) -> PixelWindow:
        """One tile of a scaled frame, anywhere in it."""
        tile_width, tile_height = min(self.tile, width), min(self.tile, height)
        return PixelWindow(
            random.randint(0, width - tile_width),
            random.randint(0, height - tile_height),
            tile_width,
            tile_height,
        )
