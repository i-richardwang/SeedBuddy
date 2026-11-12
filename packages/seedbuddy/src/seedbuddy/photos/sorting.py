"""Sort a folder of photographs into dishes, the sharpest of each first.

Each photograph carries its own judgment of whether its seeds can be counted:
the sharpest photograph of a dish can still be too soft.
"""

from __future__ import annotations

import itertools
from collections import deque
from collections.abc import Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from seedbuddy.photos.dish import locate_dish
from seedbuddy.photos.fingerprint import Survey, dish_motion, survey
from seedbuddy.photos.photographs import Progress, Skipped, photographs_in
from seedbuddy.photos.sharpness import SeedView, relative_sharpness, seed_view
from seedbuddy.photos.suitability import uncountable

Links = dict[tuple[int, int], np.ndarray]
"""Camera motions between photographs known to show the same dish."""

Comparison = tuple[int, int, float]
"""Two photographs and the log ratio of their seed sharpness."""

Alignment = tuple[tuple[float, float, float], tuple[float, float, float]]
"""A camera motion, as the two rows of its affine matrix."""

IN_PLACE: Alignment = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0))


@dataclass(frozen=True)
class Shot:
    path: Path
    sharpness: float | None
    """Log ratio of seed sharpness against the first shot; None when unmeasured."""
    reason: str | None
    """Why the seeds cannot be counted; None when they can."""
    alignment: Alignment
    """The camera motion carrying this shot onto the first shot of its dish."""

    @property
    def suitable(self) -> bool:
        return self.reason is None


@dataclass(frozen=True)
class Dish:
    shots: tuple[Shot, ...]
    """Sharpest first."""


@dataclass(frozen=True)
class Sorted:
    dishes: tuple[Dish, ...]
    skipped: tuple[Skipped, ...]


@dataclass(frozen=True)
class _Member:
    survey: Survey
    reason: str | None


def sort_photographs(folder: Path, progress: Progress) -> Sorted:
    paths = photographs_in(folder)
    with ThreadPoolExecutor() as pool:
        progress(f"Surveying {len(paths)} photographs")
        outcomes = list(pool.map(_member, paths))
        members = [outcome for outcome in outcomes if isinstance(outcome, _Member)]
        skipped = tuple(outcome for outcome in outcomes if isinstance(outcome, Skipped))

        progress("Matching photographs of the same dish")
        pairs = list(itertools.combinations(range(len(members)), 2))
        motions = pool.map(
            lambda pair: dish_motion(*(members[i].survey for i in pair)), pairs
        )
        links = {
            pair: motion
            for pair, motion in zip(pairs, motions, strict=True)
            if motion is not None
        }

        groups = _groups(len(members), links)
        progress(f"Ranking {sum(len(group) > 1 for group in groups)} dishes by focus")
        dishes = pool.map(
            lambda group: _rank([members[i] for i in group], _within(group, links)),
            groups,
        )
        return Sorted(tuple(dishes), skipped)


def _member(path: Path) -> _Member | Skipped:
    color = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if color is None:
        return Skipped(path, "unreadable")
    gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
    dish = locate_dish(gray)
    if dish is None:
        return Skipped(path, "no dish found")
    return _Member(survey(path, gray, dish), uncountable(color, dish))


def _groups(count: int, pairs: Iterable[tuple[int, int]]) -> list[list[int]]:
    """Photographs joined by any chain of pairs, in folder order."""
    parent = list(range(count))

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b in pairs:
        parent[root(a)] = root(b)
    groups: dict[int, list[int]] = {}
    for i in range(count):
        groups.setdefault(root(i), []).append(i)
    return sorted(groups.values(), key=lambda group: group[0])


def _within(group: Sequence[int], links: Links) -> Links:
    """The links among one group, indexed by position within it."""
    position = {index: i for i, index in enumerate(group)}
    return {
        (position[a], position[b]): motion
        for (a, b), motion in links.items()
        if a in position and b in position
    }


def _rank(members: Sequence[_Member], links: Links) -> Dish:
    if len(members) == 1:
        only = members[0]
        return Dish((Shot(only.survey.path, None, only.reason, IN_PLACE),))

    views = [_seed_view(member) for member in members]
    comparisons: list[Comparison] = []
    for (i, j), motion in links.items():
        view_a, view_b = views[i], views[j]
        if view_a is None or view_b is None:
            continue
        ratio = relative_sharpness(view_a, view_b, motion)
        if ratio is not None:
            comparisons.append((i, j, ratio))

    scores = _scores(_connected(len(members), comparisons))
    best = max(scores.values(), default=0.0)
    order = sorted(
        range(len(members)),
        key=lambda i: (i not in scores, -scores.get(i, 0.0), members[i].survey.path),
    )
    onto_first = _onto(order[0], len(members), links)
    return Dish(
        tuple(
            Shot(
                members[i].survey.path,
                scores[i] - best if i in scores else None,
                members[i].reason,
                onto_first[i],
            )
            for i in order
        )
    )


def _seed_view(member: _Member) -> SeedView | None:
    color = cv2.imread(str(member.survey.path), cv2.IMREAD_COLOR)
    if color is None:
        return None
    return seed_view(cv2.cvtColor(color, cv2.COLOR_BGR2GRAY), member.survey.dish)


def _connected(count: int, comparisons: Sequence[Comparison]) -> list[Comparison]:
    """The comparisons among the largest set of photographs they chain together.

    Ratios fix sharpness only relative to photographs compared through some
    chain, so scores from separate chains cannot be ranked against each other.
    """
    largest = set(max(_groups(count, ((i, j) for i, j, _ in comparisons)), key=len))
    return [comparison for comparison in comparisons if comparison[0] in largest]


def _scores(comparisons: Sequence[Comparison]) -> dict[int, float]:
    """One sharpness per photograph that best explains every pairwise ratio."""
    measured = sorted({k for i, j, _ in comparisons for k in (i, j)})
    column = {i: k for k, i in enumerate(measured)}
    rows = np.zeros((len(comparisons) + 1, len(measured)))
    values = np.zeros(len(comparisons) + 1)
    for row, (i, j, ratio) in enumerate(comparisons):
        rows[row, column[i]], rows[row, column[j]] = 1.0, -1.0
        values[row] = ratio
    # Only differences are observed; fixing their sum makes the solution unique.
    rows[-1, :] = 1.0
    solution = np.linalg.lstsq(rows, values, rcond=None)[0]
    return {i: float(solution[k]) for i, k in column.items()}


def _onto(target: int, count: int, links: Links) -> list[Alignment]:
    """The motion carrying each photograph of a group onto ``target``.

    A photograph linked to ``target`` only through others is carried along the
    shortest chain of links.
    """
    steps: dict[tuple[int, int], np.ndarray] = {}
    for (a, b), motion in links.items():
        forward = np.vstack([motion, [0.0, 0.0, 1.0]])
        steps[a, b] = forward
        steps[b, a] = np.linalg.inv(forward)
    onto = {target: np.eye(3)}
    reached = deque([target])
    while reached:
        near = reached.popleft()
        for (a, b), step in steps.items():
            if b == near and a not in onto:
                onto[a] = onto[near] @ step
                reached.append(a)
    return [_alignment(onto[i]) for i in range(count)]


def _alignment(motion: np.ndarray) -> Alignment:
    (a, b, e), (c, d, f) = motion[:2].tolist()
    return (a, b, e), (c, d, f)
