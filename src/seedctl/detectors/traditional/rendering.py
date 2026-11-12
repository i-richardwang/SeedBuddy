from __future__ import annotations

from typing import Any, cast

import cv2
import numpy as np

from seedctl.detectors.traditional.detection import CandidateSelection
from seedctl.detectors.traditional.geometry import DishRegions
from seedctl.detectors.traditional.normalization import NormalizedImage


def _score_preview(score: np.ndarray, mask: np.ndarray) -> np.ndarray:
    values = score[mask]
    low, high = np.percentile(values, (1, 99.5))
    normalized = np.clip((score - low) / max(high - low, 1e-6), 0, 1)
    source = cast(Any, np.uint8(normalized * 255))
    return cv2.applyColorMap(source, cv2.COLORMAP_TURBO)


def _region_boundary(labels: np.ndarray) -> np.ndarray:
    padded = np.pad(labels, 1, mode="constant")
    return (labels > 0) & (
        (labels != padded[:-2, 1:-1])
        | (labels != padded[2:, 1:-1])
        | (labels != padded[1:-1, :-2])
        | (labels != padded[1:-1, 2:])
    )


def _draw_detections(image: np.ndarray, detection: CandidateSelection) -> None:
    font_scale = max(0.35, min(0.65, min(image.shape[:2]) / 6000.0))
    thickness = max(1, round(font_scale * 2))
    for seed in detection.detections:
        point = (round(seed.x), round(seed.y))
        cv2.circle(image, point, max(3, thickness + 2), (0, 0, 255), -1)
        cv2.putText(
            image,
            str(seed.detection_id),
            (point[0] + 5, point[1] - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            (0, 255, 255),
            thickness,
            cv2.LINE_AA,
        )


def render_overlay(
    image: np.ndarray,
    geometry: DishRegions,
    detection: CandidateSelection,
    labels: np.ndarray,
) -> np.ndarray:
    overlay = image.copy()
    boundary = cv2.dilate(
        _region_boundary(labels).astype(np.uint8), np.ones((3, 3), np.uint8)
    )
    overlay[boundary > 0] = (40, 255, 40)
    for mask, color in (
        (geometry.reference_mask, (255, 180, 0)),
        (geometry.search_mask, (255, 0, 180)),
    ):
        contours, _ = cv2.findContours(
            mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        cv2.drawContours(overlay, contours, -1, color, 3, cv2.LINE_AA)
    _draw_detections(overlay, detection)
    return overlay


def render_debug(
    image: np.ndarray,
    geometry: DishRegions,
    normalized: NormalizedImage,
    detection: CandidateSelection,
    labels: np.ndarray,
) -> np.ndarray:
    height, width = image.shape[:2]
    scale = min(1.0, 1500.0 / width)
    size = (round(width * scale), round(height * scale))

    region_preview = image.copy()
    region_preview[~geometry.search_mask] = (
        region_preview[~geometry.search_mask] * 0.20
    ).astype(np.uint8)
    brightness_preview = _score_preview(normalized.brightness, geometry.search_mask)
    color_preview = _score_preview(
        np.maximum(normalized.warm_chroma, 0.0), geometry.search_mask
    )
    decision_preview = image.copy()
    for candidate in detection.candidates:
        color = (0, round(255 * candidate.confidence), 255)
        cv2.circle(
            decision_preview,
            (round(candidate.proposal.x), round(candidate.proposal.y)),
            max(2, round(candidate.proposal.scale * 0.25)),
            color,
            1,
            cv2.LINE_AA,
        )
    decision_preview[_region_boundary(labels)] = (40, 255, 40)
    _draw_detections(decision_preview, detection)

    panels = [
        (region_preview, "reference and search regions"),
        (brightness_preview, "normalized lightness"),
        (color_preview, "normalized warm chroma"),
        (decision_preview, "candidate confidence and detections"),
    ]
    rendered: list[np.ndarray] = []
    for panel, title in panels:
        resized = cv2.resize(panel, size, interpolation=cv2.INTER_AREA)
        cv2.rectangle(resized, (0, 0), (520, 48), (0, 0, 0), -1)
        cv2.putText(
            resized,
            title,
            (12, 34),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.85,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        rendered.append(resized)
    return np.vstack([np.hstack(rendered[:2]), np.hstack(rendered[2:])])
