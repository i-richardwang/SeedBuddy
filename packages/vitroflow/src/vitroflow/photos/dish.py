"""Locate the dish circle in a grayscale photograph.

The dish recipe is byte-identical to the workbench recipe.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from importlib.resources import files

import cv2
import numpy as np

RECIPE = json.loads(files("vitroflow.photos").joinpath("dish-recipe.json").read_text())


@dataclass(frozen=True)
class DishCircle:
    x: float
    y: float
    radius: float


def locate_dish(gray: np.ndarray) -> DishCircle | None:
    height, width = gray.shape
    scale = min(1.0, RECIPE["thumbnailLongEdge"] / max(width, height))
    size = (
        max(1, math.floor(width * scale + 0.5)),
        max(1, math.floor(height * scale + 0.5)),
    )
    small = cv2.resize(gray, size, interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), RECIPE["sigma"])
    side = min(small.shape)
    circles = cv2.HoughCircles(
        small,
        cv2.HOUGH_GRADIENT,
        dp=RECIPE["dp"],
        minDist=side // 2,
        param1=RECIPE["edgeThreshold"],
        param2=RECIPE["centerThreshold"],
        minRadius=int(side * RECIPE["minRadiusFraction"]),
        maxRadius=int(side * RECIPE["maxRadiusFraction"]),
    )
    if circles is None:
        return None
    # The dish is the large circle near the middle of the frame.
    centre = np.array([small.shape[1] / 2.0, small.shape[0] / 2.0])
    x, y, radius = min(
        circles[0],
        key=lambda c: (
            np.linalg.norm(c[:2] - centre) - RECIPE["radiusPreference"] * c[2]
        ),
    )
    return DishCircle(
        x=float(x / scale), y=float(y / scale), radius=float(radius / scale)
    )
