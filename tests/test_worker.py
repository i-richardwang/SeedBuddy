from __future__ import annotations

import threading
import time
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from seedctl.contracts.protocol import WORKER_PROTOCOL, WORKER_PROTOCOL_HEADER
from seedctl.detectors.contract import RuntimeDescriptor
from seedctl.worker import session as worker_session
from seedctl.worker.connection import WorkerNotEnrolledError, WorkerProtocolError
from seedctl.worker.service import Worker
from seedctl.worker.session import DEFAULT_POLL_SECONDS, WorkerSettings

TRADITIONAL = RuntimeDescriptor(adapter="traditional", fingerprint="b" * 64)
ULTRALYTICS = RuntimeDescriptor(adapter="ultralytics", fingerprint="c" * 64)


class Workbench:
    """Answers every claim with nothing and records what was asked."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.enrolled = True
        self.protocol = WORKER_PROTOCOL

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request.url.path)
        if request.headers.get(WORKER_PROTOCOL_HEADER) != str(self.protocol):
            return httpx.Response(
                426, text=f"This workbench speaks worker protocol {self.protocol}"
            )
        if not self.enrolled:
            return httpx.Response(401)
        if request.url.path == "/api/worker/heartbeat":
            return httpx.Response(200)
        if request.url.path == "/api/worker/training/claim":
            return httpx.Response(200, json={"run": None})
        if request.url.path == "/api/worker/inference/claim":
            return httpx.Response(200, json={"assignment": None})
        return httpx.Response(404)


def _worker(
    tmp_path: Path,
    monkeypatch,
    runtimes: tuple[RuntimeDescriptor, ...],
    processes,
    on_training: Callable[[bool], None] = lambda _active: None,
) -> tuple[Worker, Workbench]:
    monkeypatch.setattr(worker_session, "available_runtimes", lambda: runtimes)
    workbench = Workbench()
    settings = WorkerSettings(
        server_url="https://example.test",
        token="secret",
        work_dir=tmp_path,
        device=None,
        poll_seconds=DEFAULT_POLL_SECONDS,
    )
    worker = Worker(
        settings,
        on_training=on_training,
        processes=processes,
        transport=httpx.MockTransport(workbench),
    )
    return worker, workbench


def test_a_worker_that_can_train_asks_for_a_run_before_an_image(
    tmp_path: Path, monkeypatch, processes
) -> None:
    served, workbench = _worker(
        tmp_path, monkeypatch, (TRADITIONAL, ULTRALYTICS), processes
    )
    try:
        assert served.serve_once(threading.Event()) is False
    finally:
        served.close()
    assert workbench.calls == [
        "/api/worker/heartbeat",
        "/api/worker/training/claim",
        "/api/worker/inference/claim",
    ]


def test_a_worker_without_ultralytics_only_detects(
    tmp_path: Path, monkeypatch, processes
) -> None:
    served, workbench = _worker(tmp_path, monkeypatch, (TRADITIONAL,), processes)
    try:
        assert served.serve_once(threading.Event()) is False
    finally:
        served.close()
    assert workbench.calls == ["/api/worker/heartbeat", "/api/worker/inference/claim"]


def test_a_stopping_worker_takes_nothing(
    tmp_path: Path, monkeypatch, processes
) -> None:
    served, workbench = _worker(
        tmp_path, monkeypatch, (TRADITIONAL, ULTRALYTICS), processes
    )
    stopped = threading.Event()
    stopped.set()
    try:
        assert served.serve_once(stopped) is False
    finally:
        served.close()
    assert workbench.calls == ["/api/worker/heartbeat"]


def test_drain_during_claim_finishes_that_task_and_takes_no_more(
    tmp_path, monkeypatch, processes
):
    from seedctl.worker import service

    served, workbench = _worker(
        tmp_path, monkeypatch, (TRADITIONAL, ULTRALYTICS), processes
    )
    draining, stopped = threading.Event(), threading.Event()
    completed = []

    def claim():
        draining.set()
        return object()

    def train(*_args, **options):
        assert not options["stopped"].is_set()
        completed.append("trained")

    monkeypatch.setattr(served.training, "claim", claim)
    monkeypatch.setattr(service, "serve_training_claim", train)
    try:
        assert served.serve_once(stopped, draining)
        assert not served.serve_once(stopped, draining)
        assert completed == ["trained"]
        assert workbench.calls == ["/api/worker/heartbeat", "/api/worker/heartbeat"]
    finally:
        served.close()


def test_a_removed_worker_stops_instead_of_retrying(
    tmp_path: Path, monkeypatch, processes
) -> None:
    served, workbench = _worker(tmp_path, monkeypatch, (TRADITIONAL,), processes)
    workbench.enrolled = False
    try:
        with pytest.raises(WorkerNotEnrolledError):
            served.serve_once(threading.Event())
    finally:
        served.close()
    assert workbench.calls == ["/api/worker/heartbeat"]


def test_a_worker_of_another_protocol_revision_stops_instead_of_retrying(
    tmp_path: Path, monkeypatch, processes
) -> None:
    served, workbench = _worker(tmp_path, monkeypatch, (TRADITIONAL,), processes)
    workbench.protocol = WORKER_PROTOCOL + 1
    try:
        with pytest.raises(
            WorkerProtocolError, match=f"protocol {WORKER_PROTOCOL + 1}"
        ):
            served.serve_once(threading.Event())
    finally:
        served.close()
    assert workbench.calls == ["/api/worker/heartbeat"]


def test_training_stops_the_inference_process_and_releases_its_own_allocations(
    tmp_path: Path, monkeypatch, processes
) -> None:
    from seedctl.worker import service as worker

    reported: list[bool] = []
    served, _ = _worker(
        tmp_path, monkeypatch, (TRADITIONAL, ULTRALYTICS), processes, reported.append
    )
    events: list[str] = []
    claims = iter([None, object(), object()])
    monkeypatch.setattr(served.training, "claim", lambda: next(claims))
    monkeypatch.setattr(
        served.runner, "run_once", lambda _stopped: events.append("inference") or True
    )
    monkeypatch.setattr(
        served.runner, "close", lambda: events.append("close inference")
    )
    monkeypatch.setattr(worker, "release_accelerator", lambda: events.append("release"))

    def train(*args, **kwargs):
        assert events[-1] == "close inference"
        events.append("training")

    monkeypatch.setattr(worker, "serve_training_claim", train)
    try:
        assert served.serve_once(threading.Event()) is True
        assert served.serve_once(threading.Event()) is True
        assert events == ["inference", "close inference", "training", "release"]
        assert reported == [True, False]

        def fail(*args, **kwargs):
            raise RuntimeError("training failed")

        monkeypatch.setattr(worker, "serve_training_claim", fail)
        with pytest.raises(RuntimeError, match="training failed"):
            served.serve_once(threading.Event())
        assert events[-2:] == ["close inference", "release"]
        assert reported == [True, False, True, False]
    finally:
        served.close()


@pytest.mark.parametrize("failure", ["renew", "heartbeat"])
def test_single_lease_stops_on_refresh_failure(monkeypatch, failure) -> None:
    monkeypatch.setattr(worker_session, "LEASE_REFRESH_SECONDS", 0.001)
    calls: list[str] = []

    def renew() -> None:
        calls.append("renew")
        if failure == "renew" and calls.count("renew") == 3:
            raise OSError("claim moved on")

    class Session:
        def heartbeat(self) -> None:
            calls.append("heartbeat")
            if failure == "heartbeat":
                raise OSError("session moved on")

    with (
        pytest.raises(worker_session.LeaseLostError, match="refresh failed"),
        worker_session.keep_lease(
            Session(),  # type: ignore[arg-type]
            renew,
            cancelled=lambda: False,
        ) as lost,
    ):
        deadline = time.monotonic() + 5
        while not lost() and time.monotonic() < deadline:
            time.sleep(0.001)
        assert lost()
    assert calls == (
        ["renew", "renew", "heartbeat", "renew"]
        if failure == "renew"
        else ["renew", "renew", "heartbeat"]
    )
