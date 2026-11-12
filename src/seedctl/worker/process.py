"""Pipe readers and process-group teardown for supervised execution."""

import os
import queue
import signal
import threading
from contextlib import suppress
from multiprocessing.connection import Connection
from typing import Any


def read_events(
    connection: Connection, request: object | None
) -> tuple[queue.Queue[tuple[str, Any]], threading.Thread]:
    events: queue.Queue[tuple[str, Any]] = queue.Queue()

    def receive() -> None:
        try:
            if request is not None:
                connection.send(request)
            while True:
                event = connection.recv()
                events.put(event)
                if event[0] in ("result", "error"):
                    return
        except (EOFError, OSError):
            events.put(("disconnected", None))

    reader = threading.Thread(target=receive, name="worker-events", daemon=True)
    reader.start()
    return events, reader


def terminate_process_group(process: Any) -> None:
    """Terminate the child and its descendants, then release the process handle."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        with suppress(ProcessLookupError, PermissionError):
            os.killpg(process.pid, sig)
        if process.is_alive():
            process.terminate() if sig == signal.SIGTERM else process.kill()
        process.join(timeout=2)
    if process.is_alive():
        raise RuntimeError("Worker process could not be terminated")
    process.close()
