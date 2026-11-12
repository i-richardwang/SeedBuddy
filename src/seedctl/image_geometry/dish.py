"""Locate a dish from a bounded thumbnail, without producing full-image masks."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from seedctl.image_geometry.recipe import DISH_RECIPE, thumbnail_geometry


@dataclass(frozen=True)
class DishCircle:
    x: float
    y: float
    radius: float


def detect_dish_circle(image: np.ndarray) -> DishCircle | None:
    height, width = image.shape[:2]
    scale, thumbnail_width, thumbnail_height = thumbnail_geometry(width, height)
    small = cv2.resize(
        image,
        (thumbnail_width, thumbnail_height),
        interpolation=cv2.INTER_AREA,
    )
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (0, 0), DISH_RECIPE["sigma"])
    sh, sw = gray.shape
    circles = cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        dp=DISH_RECIPE["dp"],
        minDist=min(sh, sw) // 2,
        param1=DISH_RECIPE["edgeThreshold"],
        param2=DISH_RECIPE["centerThreshold"],
        minRadius=int(min(sh, sw) * DISH_RECIPE["minRadiusFraction"]),
        maxRadius=int(min(sh, sw) * DISH_RECIPE["maxRadiusFraction"]),
    )
    if circles is None:
        return None

    image_center = np.array([sw / 2.0, sh / 2.0])
    best = min(
        circles[0],
        key=lambda candidate: (
            np.linalg.norm(candidate[:2] - image_center)
            - DISH_RECIPE["radiusPreference"] * candidate[2]
        ),
    )
    center_x, center_y, radius = (float(value / scale) for value in best)
    return DishCircle(x=center_x, y=center_y, radius=radius)
