"""Distinctive points of a dish photograph and their counterparts in another."""

from __future__ import annotations

import cv2
import numpy as np

from seedbuddy.photos.dish import DishCircle

# Features are found at a resolution where the dish has this radius, so every
# threshold expressed in dish radii holds for any camera.
WORKING_RADIUS = 700.0
# Removes fine periodic texture, such as a woven filter paper, whose repeats
# match anywhere; seeds are several times larger and survive.
TEXTURE_SIGMA = 1.0
CONTRAST_THRESHOLD = 0.02
RATIO_TEST = 0.75


def features(
    gray: np.ndarray, dish: DishCircle, radius: float, limit: int = 0
) -> tuple[np.ndarray, np.ndarray]:
    """Points within ``radius`` dish radii of the centre, in full-resolution pixels.

    ``limit`` keeps only the strongest features; 0 keeps them all.
    """
    scale = min(1.0, WORKING_RADIUS / dish.radius)
    small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), TEXTURE_SIGMA)
    mask = np.zeros_like(small)
    cv2.circle(
        mask,
        (round(dish.x * scale), round(dish.y * scale)),
        round(dish.radius * scale * radius),
        255,
        -1,
    )
    sift = cv2.SIFT.create(nfeatures=limit, contrastThreshold=CONTRAST_THRESHOLD)
    keypoints, descriptors = sift.detectAndCompute(small, mask)
    points = np.array([keypoint.pt for keypoint in keypoints], np.float32)
    if descriptors is None:
        descriptors = np.empty((0, 128), np.float32)
    return points.reshape(-1, 2) / scale, descriptors


def matches(
    descriptors_a: np.ndarray, descriptors_b: np.ndarray
) -> list[tuple[int, int]]:
    """Index pairs of features that resemble each other and nothing else."""
    if len(descriptors_a) < 2 or len(descriptors_b) < 2:
        return []
    pairs = cv2.BFMatcher().knnMatch(descriptors_a, descriptors_b, k=2)
    return [
        (pair[0].queryIdx, pair[0].trainIdx)
        for pair in pairs
        if len(pair) == 2 and pair[0].distance < RATIO_TEST * pair[1].distance
    ]
