from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from seedctl.detectors.traditional.normalization import NormalizedImage
from seedctl.detectors.traditional.proposals import SeedProposal

FEATURE_NAMES = (
    "response",
    "contrast",
    "chroma",
    "support",
    "finite_support",
    "continuation",
    "texture",
    "surface_distance",
    "elongation",
    "persistence",
    "rim_clearance",
)


@dataclass(frozen=True)
class CandidateEvidence:
    response: float
    contrast: float
    chroma: float
    support: float
    finite_support: float
    continuation: float
    texture: float
    surface_distance: float
    elongation: float
    persistence: float
    rim_clearance: float

    def to_array(self) -> np.ndarray:
        return np.asarray(
            [getattr(self, name) for name in FEATURE_NAMES], dtype=np.float64
        )


def _crop(
    array: np.ndarray, x: float, y: float, radius: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    center_x, center_y = round(x), round(y)
    x_min = max(0, center_x - radius)
    x_max = min(array.shape[1], center_x + radius + 1)
    y_min = max(0, center_y - radius)
    y_max = min(array.shape[0], center_y + radius + 1)
    yy, xx = np.mgrid[y_min:y_max, x_min:x_max]
    return array[y_min:y_max, x_min:x_max], xx - x, yy - y


def _principal_direction(
    dx: np.ndarray,
    dy: np.ndarray,
    weights: np.ndarray,
) -> tuple[float, np.ndarray]:
    flat_weights = weights.ravel()
    total = float(flat_weights.sum())
    if total <= 1e-6:
        return 0.0, np.array([1.0, 0.0])

    coordinates = np.column_stack((dx.ravel(), dy.ravel()))
    center = np.sum(coordinates * flat_weights[:, None], axis=0) / total
    centered = coordinates - center
    covariance = (centered.T * flat_weights) @ centered / total
    if not np.all(np.isfinite(covariance)):
        return 0.0, np.array([1.0, 0.0])

    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    principal_variance = float(eigenvalues[1])
    if principal_variance <= 1e-6:
        return 0.0, np.array([1.0, 0.0])
    elongation = 1.0 - float(eigenvalues[0] / principal_variance)
    return float(np.clip(elongation, 0.0, 1.0)), eigenvectors[:, 1]


def _describe_candidate(
    brightness: np.ndarray,
    chroma: np.ndarray,
    surface_distance_map: np.ndarray,
    appearance: np.ndarray,
    proposal: SeedProposal,
    dish_center: tuple[float, float],
    dish_radius: float,
) -> CandidateEvidence:
    radius = max(6, round(proposal.scale * 4.0))
    patch, dx, dy = _crop(appearance, proposal.x, proposal.y, radius)
    lightness_patch, _, _ = _crop(brightness, proposal.x, proposal.y, radius)
    chroma_patch, _, _ = _crop(chroma, proposal.x, proposal.y, radius)
    distance = np.hypot(dx, dy)
    center = distance <= proposal.scale * 1.4
    annulus = (distance >= proposal.scale * 2.4) & (distance <= proposal.scale * 3.8)
    outer = (distance >= proposal.scale * 3.0) & (distance <= proposal.scale * 4.0)

    center_level = float(np.median(patch[center]))
    annulus_level = float(np.median(patch[annulus])) if np.any(annulus) else 0.0
    contrast = center_level - annulus_level
    chroma_contrast = float(np.median(chroma_patch[center])) - (
        float(np.median(chroma_patch[annulus])) if np.any(annulus) else 0.0
    )
    lightness_level = float(np.median(lightness_patch[center]))
    support = float(
        np.mean(patch[center] >= annulus_level + max(0.25, 0.25 * contrast))
    )
    outer_level = float(np.mean(patch[outer])) if np.any(outer) else center_level
    finite_support = (center_level - outer_level) / max(center_level, 1e-3)

    weights = np.maximum(patch - annulus_level, 0.0) * (
        distance <= proposal.scale * 2.4
    )
    elongation, direction = _principal_direction(dx, dy, weights)

    along = dx * direction[0] + dy * direction[1]
    across = -dx * direction[1] + dy * direction[0]
    continuation_mask = (
        (np.abs(along) >= proposal.scale * 2.2)
        & (np.abs(along) <= proposal.scale * 3.8)
        & (np.abs(across) <= proposal.scale * 0.8)
    )
    continuation = (
        float(np.mean(patch[continuation_mask])) / max(center_level, 1e-3)
        if np.any(continuation_mask)
        else 1.0
    )

    high_frequency = np.abs(patch - cv2.GaussianBlur(patch, (0, 0), 1.2))
    texture = (
        float(np.mean(high_frequency[annulus])) / max(lightness_level, 1e-3)
        if np.any(annulus)
        else 0.0
    )
    surface_patch, _, _ = _crop(surface_distance_map, proposal.x, proposal.y, radius)
    surface_distance = float(np.median(surface_patch[annulus | center]))
    center_distance = float(
        np.hypot(proposal.x - dish_center[0], proposal.y - dish_center[1])
    )
    rim_clearance = (dish_radius - center_distance) / dish_radius
    return CandidateEvidence(
        response=float(np.log1p(proposal.response)),
        contrast=contrast,
        chroma=chroma_contrast,
        support=support,
        finite_support=finite_support,
        continuation=continuation,
        texture=texture,
        surface_distance=surface_distance,
        elongation=elongation,
        persistence=proposal.persistence,
        rim_clearance=rim_clearance,
    )


def describe_candidates(
    normalized: NormalizedImage,
    proposals: list[SeedProposal],
    dish_center: tuple[float, float],
    dish_radius: float,
) -> list[CandidateEvidence]:
    brightness = normalized.brightness
    chroma = normalized.warm_chroma
    appearance = np.hypot(brightness, np.maximum(chroma, 0.0))
    return [
        _describe_candidate(
            brightness,
            chroma,
            normalized.surface_distance,
            appearance,
            proposal,
            dish_center,
            dish_radius,
        )
        for proposal in proposals
    ]
