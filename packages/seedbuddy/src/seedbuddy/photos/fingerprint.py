"""Recognize two photographs of one dish by the layout of everything in it.

Seeds, the substrate's outline and the lid's labels together form a layout no
other dish shares. Two photographs show the same dish when one rigid motion of
the camera carries that layout from one onto the other across the whole dish;
a patch that agrees alone, such as a date label every dish of a batch carries,
does not.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from seedbuddy.photos.dish import DishCircle
from seedbuddy.photos.features import features, matches

FEATURE_RADIUS = 0.95
MAX_FEATURES = 4000
# The lid sits above the seeds, so a change of camera height moves the two by
# slightly different amounts; the tolerance absorbs that parallax.
REPROJECTION_TOLERANCE = 0.014
MIN_INLIERS = 8
MIN_INLIER_SHARE = 0.5
MAX_SCALE_ERROR = 0.1
MIN_COVERAGE = 0.05


@dataclass(frozen=True)
class Survey:
    path: Path
    dish: DishCircle
    points: np.ndarray
    """Feature locations in full-resolution pixels."""
    descriptors: np.ndarray


def survey(path: Path, gray: np.ndarray, dish: DishCircle) -> Survey:
    points, descriptors = features(gray, dish, FEATURE_RADIUS, MAX_FEATURES)
    return Survey(path, dish, points, descriptors)


def dish_motion(a: Survey, b: Survey) -> np.ndarray | None:
    """The camera motion carrying a onto b, when they show the same dish."""
    paired = matches(a.descriptors, b.descriptors)
    if len(paired) < MIN_INLIERS:
        return None
    points_a = a.points[[i for i, _ in paired]]
    points_b = b.points[[j for _, j in paired]]
    motion, inliers = cv2.estimateAffinePartial2D(
        points_a,
        points_b,
        method=cv2.RANSAC,
        ransacReprojThreshold=REPROJECTION_TOLERANCE * b.dish.radius,
    )
    if motion is None or inliers is None:
        return None
    agreed = inliers.ravel().astype(bool)
    count = int(agreed.sum())
    if count < MIN_INLIERS or count / len(paired) < MIN_INLIER_SHARE:
        return None

    scale = float(np.hypot(motion[0, 0], motion[1, 0]))
    expected = b.dish.radius / a.dish.radius
    if scale <= 0 or abs(np.log(scale / expected)) > MAX_SCALE_ERROR:
        return None

    spread = cv2.contourArea(cv2.convexHull(points_b[agreed]))
    if spread / (np.pi * b.dish.radius**2) < MIN_COVERAGE:
        return None
    return motion
