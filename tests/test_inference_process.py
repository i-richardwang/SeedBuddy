from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from vitroctl.detectors.contract import RuntimeDescriptor
from vitroctl.worker.inference_process import InferenceProcess
from vitroctl.worker.session import DEFAULT_POLL_SECONDS, WorkerSession, WorkerSettings


def warm_child(connection, settings, session):
    os.setsid()
    count = 0
    while True:
        connection.recv()
        count += 1
        connection.send(("result", {"pid": os.getpid(), "count": count}))


def blocked_child(connection, settings, session):
    os.setsid()
    connection.recv()
    time.sleep(600)


def crash_child(connection, settings, session):
    os.setsid()
    connection.recv()
    os._exit(2)


def process(tmp_path: Path, monkeypatch, target) -> InferenceProcess:
    settings = WorkerSettings(
        server_url="https://example.test",
        token="secret",
        work_dir=tmp_path,
        device=None,
        poll_seconds=DEFAULT_POLL_SECONDS,
    )
    session = WorkerSession(
        "test",
        "2026-10-27T00:00:00Z",
        (RuntimeDescriptor("traditional", "b" * 64),),
        8192,
    )
    monkeypatch.setattr("vitroctl.worker.inference_process._execute", target)
    return InferenceProcess(settings, session)


def test_execution_process_is_warm_across_tasks(tmp_path, monkeypatch):
    worker = process(tmp_path, monkeypatch, warm_child)
    try:
        first = worker.run(None, time.monotonic() + 20, lambda: None)  # type: ignore[arg-type]
        second = worker.run(None, time.monotonic() + 20, lambda: None)  # type: ignore[arg-type]
        assert first["pid"] == second["pid"]
        assert second["count"] == 2
    finally:
        worker.close()
    assert worker._process is None


def test_blocked_native_call_is_killed_and_the_process_can_restart(
    tmp_path, monkeypatch
):
    worker = process(tmp_path, monkeypatch, blocked_child)
    deadline = time.monotonic() + 1

    def check():
        if time.monotonic() >= deadline:
            raise TimeoutError("deadline")

    try:
        with pytest.raises(TimeoutError):
            worker.run(None, deadline, check)  # type: ignore[arg-type]
        assert worker._process is None
        monkeypatch.setattr("vitroctl.worker.inference_process._execute", warm_child)
        assert worker.run(None, time.monotonic() + 20, lambda: None)["count"] == 1  # type: ignore[arg-type]
    finally:
        worker.close()
    assert worker._process is None


def test_crashed_process_is_reported_without_waiting_for_a_lease(tmp_path, monkeypatch):
    worker = process(tmp_path, monkeypatch, crash_child)
    try:
        with pytest.raises(RuntimeError, match="disconnected|exited"):
            worker.run(None, time.monotonic() + 20, lambda: None)  # type: ignore[arg-type]
    finally:
        worker.close()
    assert worker._process is None


def partial_reply_child(connection, settings, session):
    import struct

    os.setsid()
    connection.recv()
    os.write(connection.fileno(), struct.pack("!i", 1024) + b"partial")
    time.sleep(600)


def test_partial_pipe_frame_cannot_block_the_supervisor(tmp_path, monkeypatch):
    worker = process(tmp_path, monkeypatch, partial_reply_child)
    deadline = time.monotonic() + 1

    def check():
        if time.monotonic() >= deadline:
            raise TimeoutError("deadline")

    try:
        with pytest.raises(TimeoutError):
            worker.run(None, deadline, check)  # type: ignore[arg-type]
    finally:
        worker.close()
    assert worker._process is None
