"""Decide whether the seeds in one photograph can be told apart.

The seeds lie on the filter paper, inside the rim. They can be counted when
their own mark is crisp against the paper. They cannot when that mark has gone
soft, or when tiny droplets carpet the paper and would be counted in the seeds'
place. A germinated seed is a mark of its own, and counts.
"""

from __future__ import annotations

import cv2
import numpy as np

from seedbuddy.photos.dish import DishCircle

# The paper is judged where the dish has this radius, so a threshold expressed
# in pixels holds at any camera distance.
PAPER_RADIUS = 420
# Inside the rim, where the filter paper lies and the lid labels do not.
PAPER_REACH = 0.62
# Color departure at the scale of a seed. The weave of the paper is finer and
# drops out between these two blurs.
MARK_FINE = 1.4
MARK_COARSE = 12.0
PEAK_SPAN = 13
PEAK_FLOOR_SHARE = 99.2
PEAK_FLOOR = 1.5
PEAKS = 30
EDGE_REACH = 8
EDGE_SHARE = 90
SLOPE_SIGMA = 1.2
# A seed mark softer than this cannot be told from the paper. Thin seeds that
# can still be counted one by one, and germinated seeds, stay above it.
SOFT_EDGE = 22.0

# A carpet of droplets is many tiny, round, nearly gray spots spread across
# the paper. Colored seeds that still have a crisp edge are not that carpet,
# even when a few of them are round and bright.
DROPLET_SPOTS = 400
DROPLET_CELLS = 40
DROPLET_CHROMA = 5.0
DROPLET_EDGE = 100.0
SPOT_SPAN = 9
SPOT_BRIGHTNESS = 14
SPOT_SATURATION = 40
SPOT_CHROMA = 8
SPOT_OPENING = 2
MIN_SPOT_AREA = 3
MAX_SPOT_AREA = 60
MIN_SPOT_ASPECT = 0.7
GRID = 8


def uncountable(color: np.ndarray, dish: DishCircle) -> str | None:
    """Why the seeds in a photograph cannot be counted; None when they can."""
    view, paper, centre = _paper(color, dish)
    edge, chroma = _seed_edge(view, paper)
    spots = _spots(view, paper)
    carpet = len(spots) >= DROPLET_SPOTS and _spread(spots, centre) >= DROPLET_CELLS
    if carpet and chroma < DROPLET_CHROMA and edge < DROPLET_EDGE:
        return "paper covered by droplets"
    if edge < SOFT_EDGE:
        return "seeds are out of focus"
    return None


def _paper(
    color: np.ndarray, dish: DishCircle
) -> tuple[np.ndarray, np.ndarray, tuple[float, float]]:
    scale = PAPER_RADIUS / dish.radius
    interpolation = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
    view = cv2.resize(color, None, fx=scale, fy=scale, interpolation=interpolation)
    centre = (dish.x * scale, dish.y * scale)
    height, width = view.shape[:2]
    yy, xx = np.ogrid[:height, :width]
    paper = (xx - centre[0]) ** 2 + (yy - centre[1]) ** 2 <= (
        PAPER_RADIUS * PAPER_REACH
    ) ** 2
    return view, paper, centre


def _seed_edge(view: np.ndarray, paper: np.ndarray) -> tuple[float, float]:
    """How crisp the strongest seed-colored marks are, and how colored they are.

    The edge is read around a mark, so a large germinated seed counts as well
    as a thin one.
    """
    if not np.any(paper):
        return 0.0, 0.0
    mark = _mark(_chroma(view, paper))
    gray = cv2.cvtColor(view, cv2.COLOR_BGR2GRAY).astype(np.float32)
    slope = cv2.magnitude(
        cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3),
        cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3),
    )
    slope = cv2.GaussianBlur(slope, (0, 0), SLOPE_SIGMA)
    span = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (PEAK_SPAN, PEAK_SPAN))
    floor = max(PEAK_FLOOR, float(np.percentile(mark[paper], PEAK_FLOOR_SHARE)))
    peaks = paper & (mark >= cv2.dilate(mark, span) - 1e-6) & (mark >= floor)
    ys, xs = np.nonzero(peaks)
    if len(xs) == 0:
        return 0.0, 0.0
    chosen = np.argsort(mark[ys, xs])[::-1][:PEAKS]
    ys, xs = ys[chosen], xs[chosen]
    height, width = slope.shape
    edges = []
    for y, x in zip(ys, xs, strict=True):
        patch = slope[
            max(0, y - EDGE_REACH) : min(height, y + EDGE_REACH + 1),
            max(0, x - EDGE_REACH) : min(width, x + EDGE_REACH + 1),
        ]
        edges.append(float(np.percentile(patch, EDGE_SHARE)))
    return float(np.median(edges)), float(np.median(mark[ys, xs]))


def _mark(chroma: np.ndarray) -> np.ndarray:
    return np.clip(
        cv2.GaussianBlur(chroma, (0, 0), MARK_FINE)
        - cv2.GaussianBlur(chroma, (0, 0), MARK_COARSE),
        0,
        None,
    )


def _chroma(view: np.ndarray, paper: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(view, cv2.COLOR_BGR2LAB).astype(np.float32)
    return np.hypot(
        lab[:, :, 1] - np.median(lab[:, :, 1][paper]),
        lab[:, :, 2] - np.median(lab[:, :, 2][paper]),
    )


def _spread(spots: list[tuple[float, float]], centre: tuple[float, float]) -> int:
    """How many cells of the paper hold at least one droplet.

    Germinated seeds sit in a cluster. Droplets that hide the seeds are spread
    over the whole paper.
    """
    if not spots:
        return 0
    reach = PAPER_RADIUS * PAPER_REACH
    cells = set()
    for x, y in spots:
        column = int((x - (centre[0] - reach)) / (2 * reach) * GRID)
        row = int((y - (centre[1] - reach)) / (2 * reach) * GRID)
        cells.add((min(GRID - 1, max(0, column)), min(GRID - 1, max(0, row))))
    return len(cells)


def _spots(view: np.ndarray, paper: np.ndarray) -> list[tuple[float, float]]:
    if not np.any(paper):
        return []
    hsv = cv2.cvtColor(view, cv2.COLOR_BGR2HSV)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (SPOT_SPAN, SPOT_SPAN))
    bright = cv2.morphologyEx(hsv[:, :, 2], cv2.MORPH_TOPHAT, kernel)
    spots = (
        (bright > SPOT_BRIGHTNESS)
        & (hsv[:, :, 1] < SPOT_SATURATION)
        & (_chroma(view, paper) < SPOT_CHROMA)
        & paper
    ).astype(np.uint8)
    spots = cv2.morphologyEx(
        spots,
        cv2.MORPH_OPEN,
        np.ones((SPOT_OPENING, SPOT_OPENING), np.uint8),
    )
    count, _, stats, centres = cv2.connectedComponentsWithStats(spots, connectivity=8)
    found = []
    for index in range(1, count):
        area = int(stats[index, cv2.CC_STAT_AREA])
        width = int(stats[index, cv2.CC_STAT_WIDTH])
        height = int(stats[index, cv2.CC_STAT_HEIGHT])
        if not MIN_SPOT_AREA <= area <= MAX_SPOT_AREA or width == 0 or height == 0:
            continue
        if min(width, height) / max(width, height) < MIN_SPOT_ASPECT:
            continue
        found.append((float(centres[index, 0]), float(centres[index, 1])))
    return found
