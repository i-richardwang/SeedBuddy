"""Owned execution trees and their pipe readers."""

import multiprocessing
import os
import queue
import signal
import sys
import threading
import time
from collections.abc import Callable
from contextlib import suppress
from multiprocessing.process import BaseProcess
from typing import Any

import psutil

if sys.platform == "win32":
    from multiprocessing.connection import PipeConnection as Connection
else:
    from multiprocessing.connection import Connection


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


def _owned_entry(started: Connection, target: Callable, args: tuple) -> None:
    """No task or descendant starts before the parent has taken ownership."""
    if sys.platform != "win32":
        os.setsid()
    try:
        started.send(None)
        started.recv()
    except (EOFError, OSError):
        return
    finally:
        started.close()
    target(*args)


class ExecutionProcess:
    """One root and its descendants, closed exactly once by its scope."""

    def __init__(self, process: BaseProcess) -> None:
        self._process = process
        self._lock = threading.Lock()
        self._closed = False
        self._exitcode: int | None = None
        self._job = None
        if sys.platform == "win32":
            from seedctl.worker.windows_job import Job

            self._job = Job()

    def admit(self, started: Connection) -> None:
        with self._lock:
            if self._closed:
                raise RuntimeError("Execution scope has closed")
            if self._job is not None:
                self._job.assign(self._process.sentinel)
            started.send(None)

    def is_alive(self) -> bool:
        with self._lock:
            return not self._closed and self._process.is_alive()

    @property
    def exitcode(self) -> int | None:
        with self._lock:
            return self._exitcode if self._closed else self._process.exitcode

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            process = self._process
            if process.pid is None:
                if self._job is not None:
                    self._job.close()
                process.close()
                self._closed = True
                return
            if self._job is not None:
                self._job.close()
                # Startup may have been cancelled before assignment to the job.
                if process.is_alive():
                    process.kill()
            elif sys.platform != "win32":
                for sig in (signal.SIGTERM, signal.SIGKILL):
                    # The group can still hold descendants after its root exited.
                    # macOS can report EPERM for an already-exited group.
                    with suppress(ProcessLookupError, PermissionError):
                        os.killpg(process.pid, sig)
                    if process.is_alive():
                        process.terminate() if sig == signal.SIGTERM else process.kill()
                    process.join(timeout=2)
                deadline = time.monotonic() + 5
                while _group_running(process.pid):
                    if time.monotonic() >= deadline:
                        raise RuntimeError(
                            "Worker execution group did not finish terminating"
                        )
                    time.sleep(0.01)
            process.join(timeout=2)
            if process.is_alive():
                raise RuntimeError("Worker execution could not be terminated")
            self._exitcode = process.exitcode
            process.close()
            self._closed = True


class ExecutionCleanupError(Exception):
    """Execution ownership is unresolved; serving must return to its owner."""


class ProcessScope:
    """Owns all execution until it ends, including during blocked network calls."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._accepting = True
        self._processes: set[ExecutionProcess] = set()

    def __enter__(self):
        return self

    def __exit__(self, *_error) -> None:
        self.close()

    def start(self, target: Callable, args: tuple, *, name: str) -> ExecutionProcess:
        context = multiprocessing.get_context("spawn")
        parent, child = context.Pipe()
        process = context.Process(
            target=_owned_entry, args=(child, target, args), name=name
        )
        execution = ExecutionProcess(process)
        launched = False
        try:
            with self._lock:
                if not self._accepting:
                    raise ExecutionCleanupError("Execution scope is not accepting work")
                process.start()
                launched = True
                self._processes.add(execution)
            child.close()
            deadline = time.monotonic() + 30
            while not parent.poll(0.1):
                if not execution.is_alive():
                    raise RuntimeError("Execution ended before it was ready")
                if time.monotonic() >= deadline:
                    raise TimeoutError("Execution did not become ready")
            parent.recv()
            execution.admit(parent)
            return execution
        except BaseException:
            if launched:
                self.close_execution(execution)
            else:
                execution.close()
            raise
        finally:
            parent.close()
            child.close()

    def close_execution(self, process: ExecutionProcess) -> None:
        try:
            process.close()
        except Exception as error:
            with self._lock:
                self._accepting = False
            raise ExecutionCleanupError("Execution cleanup incomplete") from error
        with self._lock:
            self._processes.discard(process)

    def close(self) -> None:
        with self._lock:
            self._accepting = False
            processes = tuple(self._processes)
        errors = []
        for process in processes:
            try:
                self.close_execution(process)
            except Exception as error:  # noqa: BLE001 - collect failures while cleaning every owned tree
                errors.append(error)
        if errors:
            raise ExceptionGroup("Execution cleanup incomplete", errors)


if sys.platform != "win32":

    def _group_running(group: int) -> bool:
        """Observe the owned group, excluding zombies whose resources are released.

        Group membership, not ancestry or a command-line match, defines ownership.
        The root may have exited before its descendants.
        """
        for process in psutil.process_iter():
            try:
                if (
                    os.getpgid(process.pid) == group
                    and process.status() != psutil.STATUS_ZOMBIE
                ):
                    return True
            except (ProcessLookupError, psutil.NoSuchProcess):
                pass
        return False


def process_exists(pid: int) -> bool:
    """Whether this PID exists, including one we lack permission to signal."""
    return psutil.pid_exists(pid)
