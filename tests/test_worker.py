from __future__ import annotations

import threading
import time
from pathlib import Path

import httpx
import pytest

from vitroctl.detectors.contract import RuntimeDescriptor
from vitroctl.worker import session as worker_session
from vitroctl.worker.connection import WorkerNotEnrolledError
from vitroctl.worker.service import Worker
from vitroctl.worker.session import WorkerSettings

TRADITIONAL = RuntimeDescriptor(adapter="traditional", fingerprint="b" * 64)
ULTRALYTICS = RuntimeDescriptor(adapter="ultralytics", fingerprint="c" * 64)


class Workbench:
    """Answers every claim with nothing and records what was asked."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.enrolled = True

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request.url.path)
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
    tmp_path: Path, monkeypatch, runtimes: tuple[RuntimeDescriptor, ...]
) -> tuple[Worker, Workbench]:
    monkeypatch.setattr(worker_session, "available_runtimes", lambda: runtimes)
    monkeypatch.setattr(worker_session, "device_memory_bytes", lambda _device: 1)
    workbench = Workbench()
    settings = WorkerSettings(
        server_url="https://example.test",
        token="secret",
        work_dir=tmp_path,
    )
    return Worker(settings, transport=httpx.MockTransport(workbench)), workbench


def test_a_worker_that_can_train_asks_for_a_run_before_an_image(
    tmp_path: Path, monkeypatch
) -> None:
    served, workbench = _worker(tmp_path, monkeypatch, (TRADITIONAL, ULTRALYTICS))
    try:
        assert served.serve_once(threading.Event()) is False
    finally:
        served.close()
    assert workbench.calls == [
        "/api/worker/heartbeat",
        "/api/worker/training/claim",
        "/api/worker/inference/claim",
    ]


def test_a_worker_without_ultralytics_only_detects(tmp_path: Path, monkeypatch) -> None:
    served, workbench = _worker(tmp_path, monkeypatch, (TRADITIONAL,))
    try:
        assert served.serve_once(threading.Event()) is False
    finally:
        served.close()
    assert workbench.calls == ["/api/worker/heartbeat", "/api/worker/inference/claim"]


def test_a_stopping_worker_takes_nothing(tmp_path: Path, monkeypatch) -> None:
    served, workbench = _worker(tmp_path, monkeypatch, (TRADITIONAL, ULTRALYTICS))
    stopped = threading.Event()
    stopped.set()
    try:
        assert served.serve_once(stopped) is False
    finally:
        served.close()
    assert workbench.calls == ["/api/worker/heartbeat"]


def test_a_removed_worker_stops_instead_of_retrying(
    tmp_path: Path, monkeypatch
) -> None:
    served, workbench = _worker(tmp_path, monkeypatch, (TRADITIONAL,))
    workbench.enrolled = False
    try:
        with pytest.raises(WorkerNotEnrolledError):
            served.serve_once(threading.Event())
    finally:
        served.close()
    assert workbench.calls == ["/api/worker/heartbeat"]


def test_training_stops_the_inference_process_and_releases_its_own_allocations(
    tmp_path: Path, monkeypatch
) -> None:
    from vitroctl.worker import service as worker

    served, _ = _worker(tmp_path, monkeypatch, (TRADITIONAL, ULTRALYTICS))
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

        def fail(*args, **kwargs):
            raise RuntimeError("training failed")

        monkeypatch.setattr(worker, "serve_training_claim", fail)
        with pytest.raises(RuntimeError, match="training failed"):
            served.serve_once(threading.Event())
        assert events[-2:] == ["close inference", "release"]
    finally:
        served.close()


def test_one_round_renews_every_lease_and_heartbeats_once(monkeypatch) -> None:
    monkeypatch.setattr(worker_session, "LEASE_REFRESH_SECONDS", 0.001)
    calls: list[str] = []

    class Session:
        def heartbeat(self) -> None:
            calls.append("heartbeat")

    def renew(name: str, fails_after: int | None = None):
        def renew_once() -> None:
            calls.append(name)
            if fails_after is not None and calls.count(name) > fails_after:
                raise OSError("claim moved on")

        return renew_once

    keeper = worker_session.LeaseKeeper(Session())  # type: ignore[arg-type]
    kept = keeper.hold(renew("kept"))
    lost = keeper.hold(renew("lost", fails_after=2))
    deadline = time.monotonic() + 5
    while calls.count("kept") < 5 and time.monotonic() < deadline:
        time.sleep(0.001)
    keeper.close()

    assert calls.count("heartbeat") == calls.count("kept") - 1
    assert calls.count("lost") == 3
    assert lost.lost and not kept.lost
    keeper.end(kept)
    with pytest.raises(worker_session.LeaseLostError, match="refresh failed"):
        keeper.end(lost)
