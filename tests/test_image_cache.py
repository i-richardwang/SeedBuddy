from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pytest

from seedctl.worker import images
from seedctl.worker.images import ImageCache


@pytest.fixture(params=["fine", "coarse"])
def clock(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    """File times that tell every use apart, or none of them."""
    if request.param == "fine":
        return
    replace, touch = os.replace, os.utime

    def written(source: Path, target: Path) -> None:
        replace(source, target)
        touch(target, (0, 0))

    monkeypatch.setattr(images.os, "replace", written)
    monkeypatch.setattr(images.os, "utime", lambda path: touch(path, (0, 0)))


@pytest.mark.usefixtures("clock")
def test_the_cache_forgets_the_least_recently_used_image_nothing_pins(
    tmp_path: Path,
) -> None:
    contents = {
        hashlib.sha256(bytes([n]) * 10).hexdigest(): bytes([n]) * 10 for n in range(3)
    }
    touched, stale, pinned = contents
    cache = ImageCache(tmp_path, budget_bytes=20)

    def read(digest: str) -> None:
        cache.fetch(digest, contents.__getitem__).result()
        cache.release(digest)

    try:
        read(touched)
        read(stale)
        read(touched)  # read after `stale`, so `stale` is now the older one
        with cache.holding([pinned], contents.__getitem__) as pending:
            pending[pinned].result()
            read(touched)  # over budget: the stale image goes
            assert not cache.path(stale).exists()
            assert cache.path(touched).is_file()
            cache.budget_bytes = 0
            read(touched)  # nothing may stay, yet what work holds does
            assert not cache.path(touched).exists()
            assert cache.path(pinned).is_file()
    finally:
        cache.close()
