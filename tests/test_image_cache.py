from __future__ import annotations

import hashlib
from pathlib import Path

from seedctl.worker.images import ImageCache


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
