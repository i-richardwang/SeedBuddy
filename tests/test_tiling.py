from __future__ import annotations

from itertools import pairwise

import numpy as np
import pytest

from seedctl.image_geometry.tiles import Tiling
from seedctl.image_geometry.window import PixelWindow


def test_a_frame_is_read_with_its_longer_side_at_the_resolution() -> None:
    tiling = Tiling(3072, 1536)

    assert tiling.size(6240, 4160) == (3072, 2048)
    assert tiling.size(4284, 5712) == (2304, 3072)
    assert tiling.size(100, 80) == (3072, 2458)
    assert tiling.scale(np.zeros((80, 100, 3), np.uint8)).shape == (2458, 3072, 3)
    stored = np.zeros((2048, 3072, 3), np.uint8)
    assert tiling.scale(stored) is stored


def test_a_frame_is_read_whole_without_a_tile_smaller_than_the_resolution() -> None:
    assert Tiling.reading(1536, None) == Tiling(1536, 1536)
    assert Tiling.reading(1536, 2048) == Tiling(1536, 1536)
    assert Tiling.reading(3072, 1536) == Tiling(3072, 1536)


def test_a_frame_no_larger_than_a_tile_is_one_tile() -> None:
    [tile] = Tiling(1536, 1536).tiles(1536, 1024)

    assert tile.window == tile.core == PixelWindow(0, 0, 1536, 1024)
    assert Tiling(1536, 1536).passes(1536, 1024) == 1
    assert Tiling(1536, 1536).draw(1536, 1024) == tile.window


def test_tiles_overlap_evenly_and_meet_midway() -> None:
    tiles = Tiling(3072, 1536).tiles(3072, 3072)

    assert len(tiles) == 9
    assert [tile.window.x for tile in tiles[:3]] == [0, 768, 1536]
    assert [(tile.core.x, tile.core.right) for tile in tiles[:3]] == [
        (0, 1152),
        (1152, 1920),
        (1920, 3072),
    ]
    assert {(tile.window.width, tile.window.height) for tile in tiles} == {(1536, 1536)}
    assert Tiling(3072, 1536).passes(3072, 3072) == 4


@pytest.mark.parametrize(
    "resolution,tile,width,height",
    [
        (3072, 1536, 3072, 2048),
        (3072, 1536, 2304, 3072),
        (100, 64, 100, 80),
        (2560, 640, 2560, 1707),
    ],
)
def test_every_point_of_a_frame_has_one_tile_that_answers_for_it(
    resolution: int, tile: int, width: int, height: int
) -> None:
    tiles = Tiling(resolution, tile).tiles(width, height)
    answered = np.zeros((height, width), np.uint8)

    for each in tiles:
        window, core = each.window, each.core
        assert 0 <= window.x and window.right <= width
        assert 0 <= window.y and window.bottom <= height
        assert window.x <= core.x and core.right <= window.right
        assert window.y <= core.y and core.bottom <= window.bottom
        answered[core.y : core.bottom, core.x : core.right] += 1
    assert (answered == 1).all()

    # Neighbours share at least a quarter of a tile, so an object that small
    # lies whole in the tile that answers for it.
    for left, right in pairwise(tiles):
        if left.window.y == right.window.y:
            assert left.window.right - right.window.x >= tile // 4
            assert right.core.x - right.window.x >= tile // 8
            assert left.window.right - left.core.right >= tile // 8


def test_a_tile_answers_for_the_centres_in_its_core() -> None:
    left, right = Tiling(100, 64).tiles(100, 64)

    assert left.owns(49.9, 10) and not right.owns(49.9, 10)
    assert right.owns(50, 10) and not left.owns(50, 10)


def test_training_draws_tiles_inside_the_frame() -> None:
    tiling = Tiling(100, 64)

    for _ in range(50):
        window = tiling.draw(100, 80)
        assert (window.width, window.height) == (64, 64)
        assert 0 <= window.x <= 36 and 0 <= window.y <= 16
