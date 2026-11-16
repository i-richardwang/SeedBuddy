from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import numpy as np
from PIL.AvifImagePlugin import AvifImageFile
from PIL.Image import Image

#: Images are stored in one encoding, so a digest names a file outright.
CANONICAL_EXTENSION = ".avif"


@contextmanager
def _stored(path: str | Path) -> Iterator[Image]:
    source = Path(path)
    try:
        with AvifImageFile(source) as image:
            yield image
    except SyntaxError as error:
        raise ValueError(f"Unable to read image: {source.name}") from error


def image_shape(path: str | Path) -> tuple[int, int]:
    """A stored image's height and width, read without decoding its pixels."""
    with _stored(path) as image:
        return image.height, image.width


def read_image(path: str | Path) -> np.ndarray:
    """A stored image's pixels in OpenCV's blue, green, red order."""
    with _stored(path) as image:
        return np.ascontiguousarray(np.asarray(image.convert("RGB"))[..., ::-1])
