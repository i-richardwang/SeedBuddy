from __future__ import annotations

import os
import signal
import sys
import threading
from collections.abc import Iterator
from contextlib import contextmanager

# How long a hosted process has to finish once its host has let go of it.
HOSTED_GRACE_SECONDS = 30.0
# How long a hosted process waits for the one hosted before it, which may
# only just have been let go of.
HOSTED_HANDOVER_SECONDS = HOSTED_GRACE_SECONDS + 5


def _stop_with_host(stopped: threading.Event) -> None:
    """
    Stops the process when the program hosting it closes its standard input,
    by asking or by ending itself. A process still there after the grace
    period ends at once: no host is left to end it.
    """

    def watch() -> None:
        while sys.stdin.buffer.read(4096):
            pass
        stopped.set()
        overdue = threading.Timer(HOSTED_GRACE_SECONDS, os._exit, (1,))
        overdue.daemon = True
        overdue.start()

    threading.Thread(target=watch, name="worker-host", daemon=True).start()


@contextmanager
def shutdown_requests(*, hosted: bool) -> Iterator[threading.Event]:
    """
    Translate a request that the process end into cooperative Worker
    shutdown: a termination signal, or, for a hosted process, its host
    closing its standard input.
    """
    stopped = threading.Event()

    def stop(_signum: int, _frame: object) -> None:
        stopped.set()

    signals = (signal.SIGINT, signal.SIGTERM)
    previous = {current: signal.getsignal(current) for current in signals}
    for current in signals:
        signal.signal(current, stop)
    if hosted:
        _stop_with_host(stopped)
    try:
        yield stopped
    finally:
        for current, handler in previous.items():
            signal.signal(current, handler)
