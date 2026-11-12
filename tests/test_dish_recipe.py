from importlib.resources import files

import numpy as np
import pytest
from seedbuddy.photos import dish

from seedctl.image_geometry.recipe import thumbnail_geometry


def test_packages_share_the_dish_recipe() -> None:
    assert (
        files("seedbuddy.photos").joinpath("dish-recipe.json").read_bytes()
        == files("seedctl.image_geometry").joinpath("dish-recipe.json").read_bytes()
    )


@pytest.mark.parametrize(
    "width,height",
    [
        (2400, 1201),
        (1201, 2400),
        (1200, 601),
        (601, 1200),
        (1600, 801),
        (801, 1600),
        (100, 80),
        (1, 5000),
        (4032, 3024),
    ],
)
def test_photo_dish_resize_matches_shared_half_up_geometry(monkeypatch, width, height):
    shapes = []

    def hough(pixels, *args, **kwargs):
        shapes.append(pixels.shape)

    monkeypatch.setattr(dish.cv2, "HoughCircles", hough)
    dish.locate_dish(np.zeros((height, width), dtype=np.uint8))
    _, expected_width, expected_height = thumbnail_geometry(width, height)
    assert shapes == [(expected_height, expected_width)]
