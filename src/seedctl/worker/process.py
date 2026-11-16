"""Pipe readers and process-group teardown for supervised execution."""

import os
import queue
import signal
import subprocess
import sys
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


def lead_process_group() -> None:
    """
    Makes the calling process the leader of a group of its own, so that the
    processes it starts end with it. Windows has no such groups and finds a
    process's descendants when it ends them.
    """
    if sys.platform != "win32":
        os.setsid()


def terminate_process_group(process: Any) -> None:
    """Terminate the child and its descendants, then release the process handle."""
    if sys.platform == "win32":
        # Nothing asks a Windows process to finish: the tree is ended at once.
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(process.pid)],
            capture_output=True,
            check=False,
        )
        process.join(timeout=2)
    else:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            with suppress(ProcessLookupError, PermissionError):
                os.killpg(process.pid, sig)
            if process.is_alive():
                process.terminate() if sig == signal.SIGTERM else process.kill()
            process.join(timeout=2)
    if process.is_alive():
        raise RuntimeError("Worker process could not be terminated")
    process.close()


def process_exists(pid: int) -> bool:
    """Whether a process with this id is running."""
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        # Signal 0 does not ask on Windows: `os.kill` ends the process there.
        query_limited_information, still_active = 0x1000, 259
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.restype = wintypes.HANDLE
        handle = kernel.OpenProcess(query_limited_information, False, pid)
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            answered = kernel.GetExitCodeProcess(handle, ctypes.byref(code))
            return bool(answered) and code.value == still_active
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True
