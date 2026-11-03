"""The canonical images this machine holds, shared by inference and training.

An image is named by the digest of its bytes and never changes, so one copy
serves every model version that reads it and every run that trains on it. A
file appears under its digest only after its bytes were verified, so a file
that exists is the image. Work pins what it is about to read; the cache keeps
within its budget by forgetting the least recently used images nothing pins.
"""

from __future__ import annotations

import logging
import os
import shutil
import threading
import time
from collections import Counter
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import CancelledError, Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from vitroctl.io.files import content_digest, verify_digest
from vitroctl.io.image_io import CANONICAL_EXTENSION

LOGGER = logging.getLogger(__name__)

BUDGET_BYTES = 20 * 1024**3
DOWNLOADS = 4
_PARTIAL = ".partial"

Download = Callable[[str], bytes]


class ImageCache:
    def __init__(self, root: Path, budget_bytes: int = BUDGET_BYTES) -> None:
        self.root = root
        self.budget_bytes = budget_bytes
        self._lock = threading.Lock()
        self._sizes: dict[str, int] = {}
        self._pins: Counter[str] = Counter()
        self._pending: dict[str, Future[Path]] = {}
        self._pool = ThreadPoolExecutor(
            max_workers=DOWNLOADS, thread_name_prefix="image-fetch"
        )
        # An interrupted write never became an image; nothing can resume it.
        shutil.rmtree(root / _PARTIAL, ignore_errors=True)
        for path in root.glob(f"??/*{CANONICAL_EXTENSION}"):
            self._sizes[path.name.removesuffix(CANONICAL_EXTENSION)] = (
                path.stat().st_size
            )

    def path(self, digest: str) -> Path:
        return self.root / digest[:2] / f"{digest}{CANONICAL_EXTENSION}"

    def fetch(self, digest: str, download: Download) -> Future[Path]:
        """
        Pin the image and answer with its file once it is here. Each call is
        one pin that the caller ends with `release`, whether or not the
        fetch succeeded. Concurrent fetches of one digest share one download.
        """
        with self._lock:
            self._pins[digest] += 1
            if digest in self._sizes and self._touch(digest):
                done: Future[Path] = Future()
                done.set_result(self.path(digest))
                return done
            pending = self._pending.get(digest)
            if pending is None:
                pending = self._pool.submit(self._download, digest, download)
                self._pending[digest] = pending
            return pending

    def release(self, digest: str) -> None:
        with self._lock:
            self._pins[digest] -= 1
            if self._pins[digest] <= 0:
                del self._pins[digest]
            self._trim()

    @contextmanager
    def holding(
        self, digests: Iterable[str], download: Download
    ) -> Iterator[dict[str, Future[Path]]]:
        """Pin a set of images for as long as the work that reads them runs."""
        pending: dict[str, Future[Path]] = {}
        try:
            for digest in dict.fromkeys(digests):
                pending[digest] = self.fetch(digest, download)
            yield pending
        finally:
            for digest in pending:
                self.release(digest)

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)

    def _download(self, digest: str, download: Download) -> Path:
        try:
            started = time.monotonic()
            data = download(digest)
            verify_digest(content_digest(data), digest)
            target = self.path(digest)
            target.parent.mkdir(parents=True, exist_ok=True)
            partial = self.root / _PARTIAL / f"{digest}.{uuid4().hex}"
            partial.parent.mkdir(parents=True, exist_ok=True)
            partial.write_bytes(data)
            os.replace(partial, target)
            with self._lock:
                self._sizes[digest] = len(data)
            LOGGER.info(
                "fetched %s (%.1f MB) in %.1fs",
                digest,
                len(data) / 1e6,
                time.monotonic() - started,
            )
            return target
        finally:
            with self._lock:
                self._pending.pop(digest, None)

    def _trim(self) -> None:
        total = sum(self._sizes.values())
        if total <= self.budget_bytes:
            return
        idle = [digest for digest in self._sizes if digest not in self._pins]
        idle.sort(key=lambda digest: self.path(digest).stat().st_mtime)
        for digest in idle:
            if total <= self.budget_bytes:
                break
            self.path(digest).unlink()
            total -= self._sizes.pop(digest)

    def _touch(self, digest: str) -> bool:
        """
        Mark the image used, since recency orders what the budget forgets.
        A file someone removed behind the cache's back is fetched again,
        never handed to a detector that would record its absence as a result.
        """
        try:
            os.utime(self.path(digest))
        except FileNotFoundError:
            del self._sizes[digest]
            return False
        return True


def wait_for(
    future: Future[Path],
    cancelled: Callable[[], bool],
    *,
    poll_seconds: float = 0.5,
) -> Path:
    """The fetched file, or `CancelledError` once the caller stops waiting."""
    while True:
        if cancelled():
            raise CancelledError
        try:
            return future.result(timeout=poll_seconds)
        except FutureTimeoutError:
            continue
