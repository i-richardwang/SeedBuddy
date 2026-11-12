from __future__ import annotations

import numpy as np

from seedctl.detectors.traditional.results import SeedDetection


def render_regions(
    shape: tuple[int, int],
    detections: list[SeedDetection],
    window_radius: int,
) -> np.ndarray:
    labels = np.zeros(shape, dtype=np.int32)
    if not detections:
        return labels
    detections_by_id = {detection.detection_id: detection for detection in detections}
    for detection in detections:
        center_x, center_y = round(detection.x), round(detection.y)
        radius = max(window_radius, round(detection.scale * 2.5))
        x_min = max(0, center_x - radius)
        x_max = min(shape[1], center_x + radius + 1)
        y_min = max(0, center_y - radius)
        y_max = min(shape[0], center_y + radius + 1)
        yy, xx = np.mgrid[y_min:y_max, x_min:x_max]
        inside = (xx - detection.x) ** 2 + (yy - detection.y) ** 2 <= radius**2
        crop = labels[y_min:y_max, x_min:x_max]
        empty = crop == 0
        crop[inside & empty] = detection.detection_id
        overlap = inside & ~empty
        if np.any(overlap):
            previous_ids = crop[overlap]
            previous_x = np.asarray(
                [detections_by_id[int(label)].x for label in previous_ids]
            )
            previous_y = np.asarray(
                [detections_by_id[int(label)].y for label in previous_ids]
            )
            overlap_y, overlap_x = yy[overlap], xx[overlap]
            old_distance = (overlap_x - previous_x) ** 2 + (overlap_y - previous_y) ** 2
            new_distance = (overlap_x - detection.x) ** 2 + (
                overlap_y - detection.y
            ) ** 2
            crop_indices = np.where(overlap)
            replace = new_distance < old_distance
            crop[crop_indices[0][replace], crop_indices[1][replace]] = (
                detection.detection_id
            )
    return labels
