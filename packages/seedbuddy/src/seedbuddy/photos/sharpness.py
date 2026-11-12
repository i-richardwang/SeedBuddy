"""Compare how sharply two photographs of one dish render its seeds.

Both photographs are measured at the same physical points, so content cancels
and only focus remains. At each point, detail finer than a seed's outline is
weighed against the outline itself: defocus erodes the first faster than the
second, while exposure scales both alike. Labels sit on the lid, in another
focal plane, so only points well inside the dish take part.

The lid is higher than the seeds, so a change of camera height moves the seeds
a little differently from the dish as a whole. Seeds are therefore paired by
the motion of their own plane, which must stay close to the dish's.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from seedbuddy.photos.dish import DishCircle
from seedbuddy.photos.features import features, matches

SEED_REGION = 0.6
PATCH_RADIUS = 0.02
MIN_PATCH_RADIUS = 8
DETAIL_SIGMA = 0.8
OUTLINE_SIGMAS = (0.001, 0.003)
MIN_OUTLINE_VARIANCE = 1e-3
MIN_POINTS = 5
SEED_TOLERANCE = 0.005
PLANE_AGREEMENT = 0.05
AGREEMENT_PROBES = 8


@dataclass(frozen=True)
class SeedView:
    gray: np.ndarray
    dish: DishCircle
    points: np.ndarray
    """Seed-region feature locations in full-resolution pixels."""
    descriptors: np.ndarray


def seed_view(gray: np.ndarray, dish: DishCircle) -> SeedView:
    points, descriptors = features(gray, dish, SEED_REGION)
    return SeedView(gray, dish, points, descriptors)


def relative_sharpness(a: SeedView, b: SeedView, motion: np.ndarray) -> float | None:
    """Log ratio of seed sharpness of a over b; positive when a is sharper.

    ``motion`` carries the whole dish from a onto b.
    """
    paired = matches(a.descriptors, b.descriptors)
    if len(paired) < MIN_POINTS:
        return None
    points_a = a.points[[i for i, _ in paired]]
    points_b = b.points[[j for _, j in paired]]
    plane, inliers = cv2.estimateAffinePartial2D(
        points_a,
        points_b,
        method=cv2.RANSAC,
        ransacReprojThreshold=SEED_TOLERANCE * b.dish.radius,
    )
    if plane is None or inliers is None:
        return None
    if _divergence(plane, motion, a.dish) > PLANE_AGREEMENT * b.dish.radius:
        return None

    agreed = inliers.ravel().astype(bool)
    ratios = []
    for point_a, point_b in zip(points_a[agreed], points_b[agreed], strict=True):
        sharpness_a = _point_sharpness(a, point_a)
        sharpness_b = _point_sharpness(b, point_b)
        if sharpness_a is not None and sharpness_b is not None:
            ratios.append(np.log(sharpness_a / sharpness_b))
    if len(ratios) < MIN_POINTS:
        return None
    return float(np.median(ratios))


def _divergence(first: np.ndarray, second: np.ndarray, dish: DishCircle) -> float:
    """How far apart two motions carry the seed region of a dish."""
    angles = np.linspace(0, 2 * np.pi, AGREEMENT_PROBES, endpoint=False)
    ring = SEED_REGION * dish.radius
    probes = np.vstack(
        [
            [dish.x, dish.y],
            np.column_stack(
                [dish.x + ring * np.cos(angles), dish.y + ring * np.sin(angles)]
            ),
        ]
    )
    carried = [probes @ motion[:, :2].T + motion[:, 2] for motion in (first, second)]
    return float(np.max(np.hypot(*(carried[0] - carried[1]).T)))


def _point_sharpness(view: SeedView, point: np.ndarray) -> float | None:
    radius = max(MIN_PATCH_RADIUS, round(PATCH_RADIUS * view.dish.radius))
    left, top = round(float(point[0])) - radius, round(float(point[1])) - radius
    if left < 0 or top < 0:
        return None
    patch = view.gray[top : top + 2 * radius, left : left + 2 * radius]
    if patch.shape != (2 * radius, 2 * radius):
        return None
    patch = patch.astype(np.float32)
    detail = np.var(
        cv2.Laplacian(cv2.GaussianBlur(patch, (0, 0), DETAIL_SIGMA), cv2.CV_32F)
    )
    fine, coarse = (sigma * view.dish.radius for sigma in OUTLINE_SIGMAS)
    outline = np.var(
        cv2.GaussianBlur(patch, (0, 0), fine) - cv2.GaussianBlur(patch, (0, 0), coarse)
    )
    if detail <= 0 or outline < MIN_OUTLINE_VARIANCE:
        return None
    return float(detail / outline)
