from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO


@contextmanager
def atomic_directory(destination: str | Path) -> Iterator[Path]:
    target = Path(destination)
    if target.exists():
        raise FileExistsError(f"Output directory already exists: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    working = Path(tempfile.mkdtemp(prefix=f".{target.name}-", dir=target.parent))
    try:
        yield working
        working.rename(target)
    finally:
        if working.exists():
            shutil.rmtree(working)


@contextmanager
def atomic_file(destination: str | Path) -> Iterator[BinaryIO]:
    """Write a file that appears at ``destination`` complete or not at all."""
    target = Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{target.name}-", dir=target.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            yield handle
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def write_text_atomically(path: str | Path, content: str) -> None:
    with atomic_file(path) as handle:
        handle.write(content.encode("utf-8"))


def file_digest(path: str | Path) -> str:
    """SHA-256 of a file."""
    with Path(path).open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256")
    return digest.hexdigest()
