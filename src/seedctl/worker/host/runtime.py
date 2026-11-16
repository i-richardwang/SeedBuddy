from __future__ import annotations

import logging
import os
import select
import signal
import sys
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager
from pathlib import Path

from seedctl.worker.control import WorkerControl
from seedctl.worker.host.lock import running_alone
from seedctl.worker.process import ProcessScope

LOGGER = logging.getLogger(__name__)
# A stop request bounds cooperative work, including background I/O cleanup.
HOSTED_GRACE_SECONDS = 30.0
# How long a hosted process waits for the one hosted before it, which may
# only just have been let go of.
HOSTED_HANDOVER_SECONDS = HOSTED_GRACE_SECONDS + 5


def _readable(fd: int) -> bool:
    if sys.platform != "win32":
        return bool(select.select([fd], [], [], 0)[0])
    import ctypes
    import msvcrt
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.PeekNamedPipe.argtypes = (
        wintypes.HANDLE,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.DWORD),
        ctypes.c_void_p,
    )
    available = wintypes.DWORD()
    if not kernel.PeekNamedPipe(
        msvcrt.get_osfhandle(fd), None, 0, None, ctypes.byref(available), None
    ):
        if ctypes.get_last_error() == 109:  # ERROR_BROKEN_PIPE: read returns EOF.
            return True
        raise ctypes.WinError(ctypes.get_last_error())
    return available.value > 0


@contextmanager
def running_profile(
    directory: Path,
    *,
    hosted: bool,
    on_closed: Callable[[], None] | None = None,
) -> Iterator[WorkerControl]:
    """Own execution and the profile until all work has ended.

    Borrowers finish their I/O before returning. A stop deadline terminates
    execution and the interpreter even if that I/O cannot finish. Failed tree
    cleanup retains ownership and is retried; it never authorizes a handover.
    """
    processes = ProcessScope()
    control = WorkerControl(processes)
    finished = threading.Event()
    fd = sys.stdin.fileno() if hosted else None

    def stop(_signum: int, _frame: object) -> None:
        control.stop()

    def watch() -> None:
        pending = b""
        deadline: float | None = None
        while not finished.wait(0.05):
            if control.stopped.is_set():
                if deadline is None:
                    deadline = time.monotonic() + HOSTED_GRACE_SECONDS
                if time.monotonic() >= deadline:
                    try:
                        processes.close()
                    except Exception:
                        LOGGER.exception(
                            "Execution cleanup incomplete; retaining profile"
                        )
                        continue
                    os._exit(1)
            elif fd is not None:
                try:
                    if not _readable(fd):
                        continue
                    chunk = os.read(fd, 4096)
                    if not chunk:
                        control.stop()
                        continue
                    pending += chunk
                    while b"\n" in pending:
                        line, pending = pending.split(b"\n", 1)
                        if line == b"drain":
                            control.draining.set()
                        else:
                            control.stop()
                    if len(pending) > 4096:
                        control.stop()
                except OSError:
                    control.stop()

    signals = (signal.SIGINT, signal.SIGTERM)
    previous = {current: signal.getsignal(current) for current in signals}
    for current in signals:
        signal.signal(current, stop)
    watcher = threading.Thread(target=watch, name="worker-host", daemon=True)
    watcher.start()
    try:
        with ExitStack() as profile:
            try:
                profile.enter_context(
                    running_alone(
                        directory,
                        control.stopped,
                        wait=HOSTED_HANDOVER_SECONDS if hosted else 0,
                    )
                )
                if on_closed is not None:
                    profile.callback(on_closed)
                yield control
            finally:
                control.stop()
                while True:
                    try:
                        processes.close()
                        break
                    except Exception:
                        LOGGER.exception(
                            "Execution cleanup incomplete; retaining profile"
                        )
                        time.sleep(0.1)
                finished.set()
                watcher.join()
    finally:
        for current, handler in previous.items():
            signal.signal(current, handler)
