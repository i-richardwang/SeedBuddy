from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest

from vitroctl.worker.connection import WorkerHttpClient, WorkerNotEnrolledError
from vitroctl.worker.host import operations as worker_host
from vitroctl.worker.host.profiles import (
    WorkerProfile,
    profile_directory,
    save_profile,
)
from vitroctl.worker.session import WorkerSettings


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
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
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
    assert "worker: trainer" in checks
    assert checks[4:] == expected


def test_preflight_surfaces_an_installed_but_broken_runtime(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
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


def test_preflight_refuses_a_token_the_workbench_does_not_know(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    _serve_ready(monkeypatch, lambda _: httpx.Response(401))
    profile = WorkerProfile(server_url="https://example.test", token="removed")

    with pytest.raises(WorkerNotEnrolledError, match="Status page"):
        worker_host.preflight_profile("trainer", profile)


def test_profile_host_passes_typed_settings_and_marks_readiness(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            server_url="https://example.test",
            token="secret",
            device="cpu",
        ),
    )
    received: list[WorkerSettings] = []

    def run(settings: WorkerSettings, *, on_ready):
        received.append(settings)
        on_ready()
        return 0

    monkeypatch.setattr(worker_host, "run_worker", run)

    assert worker_host.run_profile("trainer") == 0

    assert len(received) == 1
    assert received[0].server_url == "https://example.test"
    assert received[0].token == "secret"
    status = json.loads(
        (profile_directory("trainer") / "status.json").read_text(encoding="utf-8")
    )
    assert status["state"] == "stopped"


def test_profile_host_records_startup_failures_in_status_and_log(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            server_url="https://example.test",
            token="secret",
        ),
    )

    def fail(_settings, *, on_ready):
        raise RuntimeError("startup failed")

    monkeypatch.setattr(worker_host, "run_worker", fail)

    assert worker_host.run_profile("trainer") == 1

    directory = profile_directory("trainer")
    status = json.loads((directory / "status.json").read_text(encoding="utf-8"))
    assert status["state"] == "failed"
    assert status["detail"] == "startup failed"
    assert "startup failed" in (directory / "worker.log").read_text(encoding="utf-8")


def test_an_unenrolled_worker_stops_cleanly_and_says_why(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(server_url="https://example.test", token="removed"),
    )

    def refused(_settings, *, on_ready):
        raise WorkerNotEnrolledError

    monkeypatch.setattr(worker_host, "run_worker", refused)

    assert worker_host.run_profile("trainer") == 0

    status = json.loads(
        (profile_directory("trainer") / "status.json").read_text(encoding="utf-8")
    )
    assert status["state"] == "unenrolled"
    assert "Status page" in status["detail"]


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
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
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
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    _status_profile("trainer", "running")

    monkeypatch.setattr(worker_host, "service_loaded", lambda _name: True)
    assert "\trunning\tloaded\t" in worker_host.profile_summary("trainer")

    monkeypatch.setattr(worker_host, "service_loaded", lambda _name: False)
    assert "\tstale\tnot loaded\t" in worker_host.profile_summary("trainer")
