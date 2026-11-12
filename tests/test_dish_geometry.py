from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from seedctl.image_geometry.dish import detect_dish_circle
from seedctl.image_geometry.recipe import thumbnail_geometry


def test_shared_dish_detector_locates_a_ring_without_using_a_fallback():
    image = np.full((800, 1200, 3), 255, np.uint8)
    cv2.circle(image, (600, 400), 330, (0, 0, 0), 8)
    circle = detect_dish_circle(image)
    assert circle is not None
    assert abs(circle.x - 600) < 8
    assert abs(circle.y - 400) < 8
    assert abs(circle.radius - 330) < 10
    assert detect_dish_circle(np.full_like(image, 255)) is None


def test_traditional_fallback_is_local_to_seed_geometry():
    from seedctl.detectors.traditional.config import PipelineConfig
    from seedctl.detectors.traditional.geometry import estimate_geometry

    image = np.full((80, 120, 3), 255, np.uint8)
    assert detect_dish_circle(image) is None
    geometry = estimate_geometry(image, PipelineConfig())
    assert geometry.used_fallback
    assert geometry.center == (60, 40)
    assert geometry.radius == 80 * 0.43


def test_thumbnail_geometry_matches_the_shared_boundary_cases():
    cases = json.loads(
        (Path(__file__).parent / "fixtures/dish-geometry.json").read_text()
    )
    for sample in cases:
        width, height = (sample["frame"][key] for key in ("width", "height"))
        _, thumbnail_width, thumbnail_height = thumbnail_geometry(width, height)
        assert [thumbnail_width, thumbnail_height] == sample["thumbnail"]
