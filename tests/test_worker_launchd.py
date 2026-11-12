from __future__ import annotations

from pathlib import Path

from seedctl.worker.host import launchd as worker_launchd
from seedctl.worker.host.launchd import launch_agent_document, service_label
from seedctl.worker.host.profiles import WorkerProfile, save_profile


def test_launch_agent_runs_the_profile_in_foreground(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    save_profile(
        "mps-trainer",
        WorkerProfile(
            server_url="https://example.test",
            token="secret",
            device="mps",
        ),
    )

    monkeypatch.setattr(worker_launchd.shutil, "which", lambda _: "/opt/bin/seedctl")
    document = launch_agent_document("mps-trainer")

    assert service_label("mps-trainer") == "com.seedbuddy.worker.mps-trainer"
    assert document["ProgramArguments"] == [
        "/opt/bin/seedctl",
        "worker",
        "run",
        "mps-trainer",
    ]
    assert document["RunAtLoad"] is True
    assert document["KeepAlive"] == {"SuccessfulExit": False}
    assert document["ExitTimeOut"] == 60
    assert document["EnvironmentVariables"] == {"SEEDBUDDY_HOME": str(tmp_path)}
    assert document["StandardOutPath"] == "/dev/null"


def test_start_kickstarts_an_already_loaded_service(monkeypatch) -> None:
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(
        worker_launchd, "install_launch_agent", lambda _name: Path("/tmp/worker.plist")
    )
    monkeypatch.setattr(worker_launchd, "service_loaded", lambda _name: True)
    monkeypatch.setattr(worker_launchd.os, "getuid", lambda: 501)
    monkeypatch.setattr(
        worker_launchd, "_launchctl", lambda *arguments: calls.append(arguments)
    )

    worker_launchd.start_service("trainer")

    assert calls == [("kickstart", "gui/501/com.seedbuddy.worker.trainer")]


def test_restart_waits_for_the_worker_to_stop_then_loads_its_definition(
    monkeypatch,
) -> None:
    calls: list[tuple[str, ...]] = []
    loaded = iter([True, True, True, False, False])
    monkeypatch.setattr(worker_launchd, "require_launchd", lambda: None)
    monkeypatch.setattr(
        worker_launchd, "install_launch_agent", lambda _name: Path("/tmp/worker.plist")
    )
    monkeypatch.setattr(worker_launchd, "service_loaded", lambda _name: next(loaded))
    monkeypatch.setattr(worker_launchd.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(worker_launchd.os, "getuid", lambda: 501)
    monkeypatch.setattr(
        worker_launchd, "_launchctl", lambda *arguments: calls.append(arguments)
    )

    worker_launchd.restart_service("trainer")

    assert calls == [
        ("bootout", "gui/501/com.seedbuddy.worker.trainer"),
        ("bootstrap", "gui/501", "/tmp/worker.plist"),
    ]


def test_restart_bootstraps_an_unloaded_service(monkeypatch) -> None:
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(worker_launchd, "require_launchd", lambda: None)
    monkeypatch.setattr(
        worker_launchd, "install_launch_agent", lambda _name: Path("/tmp/worker.plist")
    )
    monkeypatch.setattr(worker_launchd, "service_loaded", lambda _name: False)
    monkeypatch.setattr(worker_launchd.os, "getuid", lambda: 501)
    monkeypatch.setattr(
        worker_launchd, "_launchctl", lambda *arguments: calls.append(arguments)
    )

    worker_launchd.restart_service("trainer")

    assert calls == [("bootstrap", "gui/501", "/tmp/worker.plist")]
