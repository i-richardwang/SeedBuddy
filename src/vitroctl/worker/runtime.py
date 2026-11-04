from __future__ import annotations

import signal
import threading
from collections.abc import Iterator
from contextlib import contextmanager


@contextmanager
def shutdown_signals() -> Iterator[threading.Event]:
    """Translate process termination into cooperative Worker shutdown."""
    stopped = threading.Event()

    def stop(_signum: int, _frame: object) -> None:
        stopped.set()

    signals = (signal.SIGINT, signal.SIGTERM)
    previous = {current: signal.getsignal(current) for current in signals}
    for current in signals:
        signal.signal(current, stop)
    try:
        yield stopped
    finally:
        for current, handler in previous.items():
            signal.signal(current, handler)
