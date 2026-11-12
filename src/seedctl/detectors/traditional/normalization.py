from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class NormalizedImage:
    lightness: np.ndarray
    red: np.ndarray
    yellow: np.ndarray
    surface_distance: np.ndarray
    clipped_fraction: float
    focus_score: float

    @property
    def brightness(self) -> np.ndarray:
        return np.abs(self.lightness)

    @property
    def warm_chroma(self) -> np.ndarray:
        return np.maximum(self.red, self.yellow)


def _robust_location_scale(values: np.ndarray) -> tuple[float, float]:
    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median)))
    return median, max(1.4826 * mad, 1.0)


def _reference_surface(channel: np.ndarray, reference_mask: np.ndarray) -> np.ndarray:
    stride = max(4, round(max(channel.shape) / 800))
    sampled_mask = reference_mask[::stride, ::stride]
    sampled_y, sampled_x = np.where(sampled_mask)
    sampled_y = sampled_y * stride
    sampled_x = sampled_x * stride
    x_scale = max(channel.shape[1] - 1, 1)
    y_scale = max(channel.shape[0] - 1, 1)
    x = sampled_x / x_scale * 2.0 - 1.0
    y = sampled_y / y_scale * 2.0 - 1.0
    design = np.column_stack((np.ones(len(x)), x, y, x * x, x * y, y * y))
    coefficients, *_ = np.linalg.lstsq(
        design,
        channel[sampled_y, sampled_x].astype(np.float64),
        rcond=None,
    )
    full_x = np.linspace(-1.0, 1.0, channel.shape[1], dtype=np.float32)
    full_y = np.linspace(-1.0, 1.0, channel.shape[0], dtype=np.float32)
    return (
        coefficients[0]
        + coefficients[1] * full_x[None, :]
        + coefficients[2] * full_y[:, None]
        + coefficients[3] * np.square(full_x[None, :])
        + coefficients[4] * full_y[:, None] * full_x[None, :]
        + coefficients[5] * np.square(full_y[:, None])
    ).astype(np.float32)


def normalize_image(
    image: np.ndarray,
    reference_mask: np.ndarray,
    dish_radius: float,
) -> NormalizedImage:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    residuals: list[np.ndarray] = []
    local_backgrounds: list[np.ndarray] = []
    for channel in cv2.split(lab):
        reference_surface = _reference_surface(channel, reference_mask)
        residuals.append(channel - reference_surface)
        local_backgrounds.append(
            cv2.GaussianBlur(channel, (0, 0), max(15.0, dish_radius * 0.010))
        )

    lightness_raw, red_raw, yellow_raw = residuals
    lightness_location, lightness_scale = _robust_location_scale(
        lightness_raw[reference_mask]
    )
    red_location, red_scale = _robust_location_scale(red_raw[reference_mask])
    yellow_location, yellow_scale = _robust_location_scale(yellow_raw[reference_mask])
    lightness = (lightness_raw - lightness_location) / lightness_scale
    red = (red_raw - red_location) / red_scale
    yellow = (yellow_raw - yellow_location) / yellow_scale
    surface_channels: list[np.ndarray] = []
    for background in local_backgrounds:
        location, scale = _robust_location_scale(background[reference_mask][::8])
        surface_channels.append((background - location) / scale)
    surface_distance = np.sqrt(
        np.mean(np.square(np.stack(surface_channels, axis=0)), axis=0)
    )

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    reference_pixels = gray[reference_mask]
    clipped_fraction = float(
        np.mean((reference_pixels <= 2) | (reference_pixels >= 253))
    )
    focus_score = float(cv2.Laplacian(gray, cv2.CV_32F)[reference_mask].var())
    return NormalizedImage(
        lightness=lightness.astype(np.float32),
        red=red.astype(np.float32),
        yellow=yellow.astype(np.float32),
        surface_distance=surface_distance.astype(np.float32),
        clipped_fraction=clipped_fraction,
        focus_score=focus_score,
    )
