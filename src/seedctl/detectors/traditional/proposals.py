from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from seedctl.detectors.traditional.config import ProposalConfig
from seedctl.detectors.traditional.normalization import NormalizedImage

_REFERENCE_PERCENTILE = 99.0
_THRESHOLD_FRACTION = 0.35
_MAXIMUM_PER_SCALE = 4_000


@dataclass(frozen=True)
class SeedProposal:
    x: float
    y: float
    scale: float
    response: float
    persistence: float


@dataclass(frozen=True)
class _ScaleMaximum:
    x: int
    y: int
    scale: float
    level: int
    response: float


@dataclass
class _ProposalGroup:
    anchor: _ScaleMaximum
    levels: set[int]
    x_sum: float
    y_sum: float
    scale_sum: float
    weight: float

    @classmethod
    def from_maximum(cls, maximum: _ScaleMaximum) -> _ProposalGroup:
        return cls(
            anchor=maximum,
            levels={maximum.level},
            x_sum=maximum.x * maximum.response,
            y_sum=maximum.y * maximum.response,
            scale_sum=maximum.scale * maximum.response,
            weight=maximum.response,
        )

    def add(self, maximum: _ScaleMaximum) -> None:
        self.levels.add(maximum.level)
        self.x_sum += maximum.x * maximum.response
        self.y_sum += maximum.y * maximum.response
        self.scale_sum += maximum.scale * maximum.response
        self.weight += maximum.response

    def to_proposal(self, level_count: int) -> SeedProposal:
        return SeedProposal(
            x=self.x_sum / self.weight,
            y=self.y_sum / self.weight,
            scale=self.scale_sum / self.weight,
            response=self.anchor.response,
            persistence=len(self.levels) / level_count,
        )


def _scales(dish_radius: float, config: ProposalConfig) -> np.ndarray:
    minimum = max(2.0, dish_radius * config.minimum_scale_fraction)
    maximum = max(minimum, dish_radius * config.maximum_scale_fraction)
    return np.geomspace(minimum, maximum, config.scale_levels)


def _local_maxima(
    response: np.ndarray,
    scale: float,
    level: int,
    reference_mask: np.ndarray,
    search_mask: np.ndarray,
) -> list[_ScaleMaximum]:
    reference = response[reference_mask][::8]
    reference_level = float(np.percentile(reference, _REFERENCE_PERCENTILE))
    if reference_level <= 1e-6:
        return []
    threshold = reference_level * _THRESHOLD_FRACTION
    diameter = max(3, 2 * round(scale * 0.75) + 1)
    local_maximum = cv2.dilate(
        response,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (diameter, diameter)),
    )
    ys, xs = np.where(
        search_mask & (response >= threshold) & (response == local_maximum)
    )
    if len(xs) > _MAXIMUM_PER_SCALE:
        values = response[ys, xs]
        keep = np.argpartition(values, -_MAXIMUM_PER_SCALE)[-_MAXIMUM_PER_SCALE:]
        xs, ys = xs[keep], ys[keep]
    return [
        _ScaleMaximum(
            x=int(x),
            y=int(y),
            scale=float(scale),
            level=level,
            response=float(response[y, x] / max(threshold, 1e-6)),
        )
        for x, y in zip(xs, ys, strict=True)
    ]


def _merge_across_scales(
    maxima: list[_ScaleMaximum], level_count: int
) -> list[SeedProposal]:
    if not maxima:
        return []
    cell_size = max(1.0, min(item.scale for item in maxima) * 0.70)
    groups: list[_ProposalGroup] = []
    grid: dict[tuple[int, int], list[int]] = {}
    for item in sorted(maxima, key=lambda candidate: candidate.response, reverse=True):
        cell = (int(item.x // cell_size), int(item.y // cell_size))
        matched: int | None = None
        for cell_y in range(cell[1] - 1, cell[1] + 2):
            for cell_x in range(cell[0] - 1, cell[0] + 2):
                for group_index in grid.get((cell_x, cell_y), []):
                    group = groups[group_index]
                    merge_distance = 0.70 * min(group.anchor.scale, item.scale)
                    if (group.anchor.x - item.x) ** 2 + (
                        group.anchor.y - item.y
                    ) ** 2 <= merge_distance**2:
                        matched = group_index
                        break
                if matched is not None:
                    break
            if matched is not None:
                break
        if matched is None:
            groups.append(_ProposalGroup.from_maximum(item))
            grid.setdefault(cell, []).append(len(groups) - 1)
            continue
        groups[matched].add(item)

    return [group.to_proposal(level_count) for group in groups]


def propose_seed_centers(
    normalized: NormalizedImage,
    reference_mask: np.ndarray,
    search_mask: np.ndarray,
    dish_radius: float,
    config: ProposalConfig,
) -> list[SeedProposal]:
    height, width = normalized.lightness.shape
    resize_factor = min(1.0, 3000.0 / max(height, width))
    if resize_factor < 1.0:
        size = (round(width * resize_factor), round(height * resize_factor))
        working = NormalizedImage(
            lightness=cv2.resize(
                normalized.lightness, size, interpolation=cv2.INTER_AREA
            ),
            red=cv2.resize(normalized.red, size, interpolation=cv2.INTER_AREA),
            yellow=cv2.resize(normalized.yellow, size, interpolation=cv2.INTER_AREA),
            surface_distance=cv2.resize(
                normalized.surface_distance, size, interpolation=cv2.INTER_AREA
            ),
            clipped_fraction=normalized.clipped_fraction,
            focus_score=normalized.focus_score,
        )
        reference_mask = cv2.resize(
            reference_mask.astype(np.uint8), size, interpolation=cv2.INTER_NEAREST
        ).astype(bool)
        search_mask = cv2.resize(
            search_mask.astype(np.uint8), size, interpolation=cv2.INTER_NEAREST
        ).astype(bool)
    else:
        working = normalized

    appearance = np.hypot(working.brightness, np.maximum(working.warm_chroma, 0.0))
    maxima: list[_ScaleMaximum] = []
    scales = _scales(dish_radius * resize_factor, config)
    for level, scale in enumerate(scales):
        support = cv2.GaussianBlur(appearance, (0, 0), max(1.0, scale * 0.45))
        smoothed_lightness = cv2.GaussianBlur(
            working.lightness, (0, 0), max(1.0, scale * 0.65)
        )
        laplacian = (
            np.abs(cv2.Laplacian(smoothed_lightness, cv2.CV_32F, ksize=3)) * scale**2
        )
        response = support + 0.20 * laplacian
        maxima.extend(
            _local_maxima(
                response,
                float(scale),
                level,
                reference_mask,
                search_mask,
            )
        )
    proposals = _merge_across_scales(maxima, len(scales))
    if resize_factor == 1.0:
        return proposals
    return [
        SeedProposal(
            x=proposal.x / resize_factor,
            y=proposal.y / resize_factor,
            scale=proposal.scale / resize_factor,
            response=proposal.response,
            persistence=proposal.persistence,
        )
        for proposal in proposals
    ]
