"""The photograph files a command is asked to read."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

PHOTO_SUFFIXES = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}

Progress = Callable[[str], None]


@dataclass(frozen=True)
class Skipped:
    path: Path
    reason: str


def photographs_in(folder: Path) -> list[Path]:
    return sorted(
        path
        for path in folder.iterdir()
        if path.is_file()
        and not path.name.startswith(".")
        and path.suffix.lower() in PHOTO_SUFFIXES
    )
