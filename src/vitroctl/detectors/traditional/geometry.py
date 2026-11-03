from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from vitroctl.detectors.traditional.config import PipelineConfig
from vitroctl.image_geometry.dish import detect_dish_circle


@dataclass(frozen=True)
class DishRegions:
    center: tuple[float, float]
    radius: float
    dish_mask: np.ndarray
    reference_mask: np.ndarray
    search_mask: np.ndarray
    used_fallback: bool


def circle_mask(
    shape: tuple[int, int], center: tuple[float, float], radius: float
) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    cv2.circle(
        mask,
        (round(center[0]), round(center[1])),
        max(1, round(radius)),
        255,
        thickness=-1,
        lineType=cv2.LINE_AA,
    )
    return mask > 0


def estimate_geometry(image: np.ndarray, config: PipelineConfig) -> DishRegions:
    circle = detect_dish_circle(image)
    shape = image.shape[:2]
    height, width = shape
    center = (circle.x, circle.y) if circle else (width / 2.0, height / 2.0)
    radius = circle.radius if circle else min(width, height) * 0.43
    return DishRegions(
        center=center,
        radius=radius,
        dish_mask=circle_mask(shape, center, radius),
        reference_mask=circle_mask(
            shape,
            center,
            radius * config.geometry.reference_radius_fraction,
        ),
        search_mask=circle_mask(
            shape,
            center,
            radius * config.geometry.search_radius_fraction,
        ),
        used_fallback=circle is None,
    )
