"""Pixel dimensions of annotated images."""

from collections.abc import Sequence


def require_image_dimensions(
    shape: Sequence[int], width: int, height: int, digest: str
) -> None:
    actual_height, actual_width = shape[:2]
    if (actual_width, actual_height) != (width, height):
        raise ValueError(
            f"Image dimensions differ from annotation for {digest}: "
            f"{actual_width}x{actual_height} != {width}x{height}"
        )
