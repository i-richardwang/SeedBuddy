"""The pixel window a dish coverage frames, as training and inference share it."""

from __future__ import annotations

import pytest

from seedctl.contracts.annotation import BoundingBox
from seedctl.contracts.coverage import ImageCoverage, decode_coverage
from seedctl.image_geometry.window import PixelWindow, coverage_window


def test_coverage_decodes_the_frozen_dish_and_encodes_it_back() -> None:
    document = {
        "kind": "dish",
        "circle": {"x": 120.5, "y": 80.0, "radius": 40.0},
        "margin": 0.15,
    }
    coverage = ImageCoverage.decode(document, "image.coverage")
    assert coverage == ImageCoverage(120.5, 80.0, 40.0, 0.15)
    assert coverage.reach == pytest.approx(46.0)
    assert coverage.to_dict() == document
    assert decode_coverage(None, "image.coverage") is None
    with pytest.raises(ValueError, match="coverage.kind must be dish"):
        ImageCoverage.decode({**document, "kind": "plate"}, "image.coverage")


def test_window_rounds_outward_and_clips_to_the_image() -> None:
    coverage = ImageCoverage(120.5, 80.0, 40.0, 0.15)
    # Reach 46: x 74.5..166.5 and y 34..126 round outward to whole pixels.
    assert coverage_window(coverage, 200, 160) == PixelWindow(74, 34, 93, 92)
    # A dish at the edge keeps only what the image holds.
    assert coverage_window(coverage, 150, 100) == PixelWindow(74, 34, 76, 66)
    assert coverage_window(ImageCoverage(10.0, 10.0, 30.0, 0.0), 50, 50) == (
        PixelWindow(0, 0, 40, 40)
    )
    with pytest.raises(ValueError, match="outside the image"):
        coverage_window(ImageCoverage(500.0, 500.0, 40.0, 0.15), 200, 160)


def test_window_crops_boxes_to_its_pixels_and_restores_them() -> None:
    window = PixelWindow(74, 34, 92, 92)
    inside = BoundingBox(100.0, 50.0, 10.0, 8.0)
    assert window.crop(inside) == BoundingBox(26.0, 16.0, 10.0, 8.0)
    assert window.restore(window.crop(inside)) == inside  # type: ignore[arg-type]
    crossing = BoundingBox(70.0, 30.0, 10.0, 10.0)
    assert window.crop(crossing) == BoundingBox(0.0, 0.0, 6.0, 6.0)
    assert window.crop(BoundingBox(0.0, 0.0, 70.0, 30.0)) is None
    assert window.crop(BoundingBox(166.0, 126.0, 5.0, 5.0)) is None
