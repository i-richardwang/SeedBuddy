from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

#: Images are stored in one encoding, so a digest names a file outright.
CANONICAL_EXTENSION = ".avif"


def read_image(path: str | Path) -> np.ndarray:
    source = Path(path)
    data = np.fromfile(source, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Unable to read image: {source.name}")
    return image
