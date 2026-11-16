from __future__ import annotations

import sys
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO


def _try_lock(handle: BinaryIO) -> bool:
    """Takes the lock the system keeps on an open file, unless a process holds it."""
    try:
        if sys.platform == "win32":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return False
    return True


@contextmanager
def running_alone(
    directory: Path, stopped: threading.Event, *, wait: float
) -> Iterator[None]:
    """
    Holds a profile for the one process that runs it: two would contend for
    the Worker's session. A process that holds it is given `wait` seconds to
    end, unless this one is asked to stop first. The system lets go of the
    lock when its process ends, however it ends.
    """
    deadline = time.monotonic() + wait
    with (directory / "run.lock").open("a+b") as handle:
        while not _try_lock(handle):
            if time.monotonic() >= deadline or stopped.wait(0.2):
                raise RuntimeError(
                    f"another process is running this worker profile: {directory.name}"
                )
        yield
