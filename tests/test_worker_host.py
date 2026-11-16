from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from types import SimpleNamespace

import httpx
import pytest

from seedctl.contracts.protocol import WORKER_PROTOCOL, WORKER_PROTOCOL_HEADER
from seedctl.worker.connection import (
    WorkerHttpClient,
    WorkerNotEnrolledError,
    WorkerProtocolError,
    WorkerSuspendedError,
)
from seedctl.worker.host import operations as worker_host
from seedctl.worker.host.lock import running_alone
from seedctl.worker.host.profiles import (
    WorkerProfile,
    profile_directory,
    save_profile,
)
from seedctl.worker.session import WorkerSettings


def _serve_ready(monkeypatch, respond) -> list[httpx.Request]:
    """Answers the readiness check through the client the host builds."""
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return respond(request)

    def client(connection, **kwargs):
        return WorkerHttpClient(
            connection, transport=httpx.MockTransport(handle), **kwargs
        )

    monkeypatch.setattr(worker_host, "WorkerHttpClient", client)
    return requests


@pytest.mark.parametrize(
    "adapters, device, expected",
    [
        (
            ("traditional", "ultralytics"),
            "cpu",
            ("runtimes: traditional, ultralytics (cpu)", "device: cpu"),
        ),
        (("traditional",), None, ("runtimes: traditional",)),
    ],
)
def test_preflight_checks_the_authenticated_server_and_runtimes(
    tmp_path, monkeypatch, adapters, device, expected
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    requests = _serve_ready(
        monkeypatch, lambda _: httpx.Response(200, json={"workerId": "trainer"})
    )
    monkeypatch.setattr(
        worker_host,
        "available_runtimes",
        lambda: tuple(SimpleNamespace(adapter=adapter) for adapter in adapters),
    )
    profile = WorkerProfile(
        server_url="https://example.test",
        token="training-secret",
        device=device,
    )

    checks = worker_host.preflight_profile("trainer", profile)

    assert requests[0].url.path == "/api/worker/ready"
    assert requests[0].headers["authorization"] == "Bearer training-secret"
    assert requests[0].headers[WORKER_PROTOCOL_HEADER] == str(WORKER_PROTOCOL)
    assert "worker: trainer" in checks
    assert checks[4:] == expected


def test_preflight_surfaces_an_installed_but_broken_runtime(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    _serve_ready(
        monkeypatch, lambda _: httpx.Response(200, json={"workerId": "mac-mps"})
    )

    def broken_runtime():
        raise RuntimeError("Ultralytics is installed but cannot be imported")

    monkeypatch.setattr(worker_host, "available_runtimes", broken_runtime)
    profile = WorkerProfile(
        server_url="https://example.test",
        token="inference-secret",
    )

    with pytest.raises(RuntimeError, match="installed but cannot be imported"):
        worker_host.preflight_profile("mac-mps", profile)


@pytest.mark.parametrize(
    ("refusal", "said"),
    [
        (httpx.Response(401), "Workers page"),
        (httpx.Response(403, text="The account is suspended"), "is suspended"),
        (httpx.Response(426, text="This workbench speaks worker protocol 2"), "2"),
    ],
)
def test_preflight_fails_for_a_worker_the_workbench_turns_away(
    tmp_path, monkeypatch, refusal: httpx.Response, said: str
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    _serve_ready(monkeypatch, lambda _: refusal)
    profile = WorkerProfile(server_url="https://example.test", token="refused")

    with pytest.raises(RuntimeError, match=said):
        worker_host.preflight_profile("trainer", profile)


def test_profile_host_passes_typed_settings_and_records_what_the_process_is_doing(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            server_url="https://example.test",
            token="secret",
            device="cpu",
        ),
    )
    received: list[WorkerSettings] = []

    def status() -> dict[str, object]:
        return json.loads(
            (profile_directory("trainer") / "status.json").read_text("utf-8")
        )

    states: list[dict[str, object]] = []

    def run(settings: WorkerSettings, _stopped, *, on_ready, on_training) -> None:
        received.append(settings)
        on_ready()
        states.append(status())
        on_training(True)
        states.append(status())
        on_training(False)
        states.append(status())

    monkeypatch.setattr(worker_host, "run_worker", run)

    assert worker_host.run_profile("trainer") == 0

    assert len(received) == 1
    assert received[0].server_url == "https://example.test"
    assert received[0].token == "secret"
    assert states == [
        {"state": state, "pid": os.getpid()}
        for state in ("running", "training", "running")
    ]
    assert status() == {"state": "stopped"}


def test_profile_host_records_startup_failures_in_status_and_log(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            server_url="https://example.test",
            token="secret",
        ),
    )

    def fail(_settings, _stopped, *, on_ready, on_training) -> None:
        raise RuntimeError("startup failed")

    monkeypatch.setattr(worker_host, "run_worker", fail)

    assert worker_host.run_profile("trainer") == 1

    directory = profile_directory("trainer")
    status = json.loads((directory / "status.json").read_text(encoding="utf-8"))
    assert status["state"] == "failed"
    assert status["detail"] == "startup failed"
    assert "startup failed" in (directory / "worker.log").read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("refusal", "state"),
    [
        (WorkerNotEnrolledError(), "unenrolled"),
        (WorkerSuspendedError("The account is suspended"), "suspended"),
        (WorkerProtocolError("This workbench speaks protocol 2"), "incompatible"),
    ],
)
def test_a_worker_the_workbench_turns_away_stops_cleanly_and_says_why(
    tmp_path, monkeypatch, refusal: Exception, state: str
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(server_url="https://example.test", token="refused"),
    )

    def refused(_settings, _stopped, *, on_ready, on_training) -> None:
        raise refusal

    monkeypatch.setattr(worker_host, "run_worker", refused)

    assert worker_host.run_profile("trainer") == 0

    status = json.loads(
        (profile_directory("trainer") / "status.json").read_text(encoding="utf-8")
    )
    assert status == {"state": state, "detail": str(refusal)}


def _status_profile(name: str, state: str, **document: object) -> None:
    save_profile(
        name,
        WorkerProfile(
            server_url="https://example.test",
            token="secret",
            device="cpu",
        ),
    )
    (profile_directory(name) / "status.json").write_text(
        json.dumps({"state": state, **document}), encoding="utf-8"
    )


def test_profile_summary_reports_the_failure_detail(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    _status_profile("trainer", "failed", detail="startup failed")
    monkeypatch.setattr(worker_host, "service_loaded", lambda _name: True)

    assert worker_host.profile_summary("trainer").split("\t") == [
        "trainer",
        "failed: startup failed",
        "loaded",
        "cpu",
    ]


def test_profile_summary_reports_a_killed_worker_as_stale(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    monkeypatch.setattr(worker_host, "service_loaded", lambda _name: False)
    ended = subprocess.Popen([sys.executable, "-c", ""])
    ended.wait()
    for state in ("starting", "running", "training"):
        _status_profile("trainer", state, pid=os.getpid())
        assert f"\t{state}\tnot loaded\t" in worker_host.profile_summary("trainer")

        _status_profile("trainer", state, pid=ended.pid)
        assert "\tstale\tnot loaded\t" in worker_host.profile_summary("trainer")


def _profile(name: str) -> None:
    save_profile(name, WorkerProfile(server_url="https://example.test", token="secret"))


def test_a_profile_another_process_runs_is_refused_and_its_status_kept(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    _profile("trainer")
    directory = profile_directory("trainer")
    (directory / "status.json").write_text('{"state": "running", "pid": 1}\n')
    monkeypatch.setattr(worker_host, "run_worker", lambda *_args, **_kwargs: None)

    with (
        running_alone(directory, threading.Event(), wait=0),
        pytest.raises(RuntimeError, match="another process is running"),
    ):
        worker_host.run_profile("trainer")

    assert json.loads((directory / "status.json").read_text("utf-8")) == {
        "state": "running",
        "pid": 1,
    }


def test_a_profile_is_free_again_once_the_process_running_it_has_ended(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    _profile("trainer")
    monkeypatch.setattr(worker_host, "run_worker", lambda *_args, **_kwargs: None)

    assert worker_host.run_profile("trainer") == 0
    assert worker_host.run_profile("trainer") == 0


def test_a_process_waiting_for_a_profile_gives_up_when_asked_to_stop(tmp_path) -> None:
    stopped = threading.Event()
    stopped.set()

    with (
        running_alone(tmp_path, threading.Event(), wait=0),
        pytest.raises(RuntimeError, match="another process is running"),
        running_alone(tmp_path, stopped, wait=60),
    ):
        pass


def _hosted(then: str, *, grace: float) -> subprocess.Popen[bytes]:
    """A process that waits to be stopped as a hosted Worker does, and then does `then`."""
    script = f"""
import sys
import time

import seedctl.worker.runtime as runtime

runtime.HOSTED_GRACE_SECONDS = {grace}
with runtime.shutdown_requests(hosted=True) as stopped:
    print("serving", flush=True)
    stopped.wait()
    {then}
"""
    process = subprocess.Popen(
        [sys.executable, "-c", script], stdin=subprocess.PIPE, stdout=subprocess.PIPE
    )
    assert process.stdout is not None
    assert process.stdout.readline().strip() == b"serving"
    return process


def _let_go(process: subprocess.Popen[bytes]) -> int:
    """Closes the standard input of a hosted process, and says how it ended."""
    assert process.stdin is not None and process.stdout is not None
    process.stdin.close()
    try:
        return process.wait(timeout=20)
    finally:
        process.stdout.close()


def test_a_hosted_process_stops_when_its_host_closes_its_standard_input() -> None:
    process = _hosted("sys.exit(7)", grace=30)
    assert process.poll() is None

    assert _let_go(process) == 7


def test_a_hosted_process_that_does_not_finish_in_time_ends_itself() -> None:
    process = _hosted("time.sleep(600)", grace=0.2)

    assert _let_go(process) == 1
