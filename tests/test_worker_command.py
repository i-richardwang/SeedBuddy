from __future__ import annotations

import io

import pytest

from seedctl.cli import main
from seedctl.worker.host import command as worker_command
from seedctl.worker.host.profiles import WorkerProfile, load_profile, save_profile


class _Terminal(io.StringIO):
    def isatty(self) -> bool:
        return True


def _at_a_terminal(monkeypatch, typed) -> None:
    """Setup runs at a terminal, where `typed` answers the token prompt."""
    monkeypatch.setattr(worker_command.sys, "stdin", _Terminal())
    monkeypatch.setattr(worker_command.getpass, "getpass", typed)


def _mock_setup(monkeypatch, *, token: str = "secret") -> list[str]:
    started: list[str] = []
    monkeypatch.setattr(worker_command, "require_launchd", lambda: None)
    _at_a_terminal(monkeypatch, lambda _prompt: token)
    monkeypatch.setattr(
        worker_command,
        "preflight_profile",
        lambda name, _profile: (f"profile: {name}",),
    )
    monkeypatch.setattr(worker_command, "start_service", started.append)
    return started


def test_setup_preflights_saves_and_starts_without_exposing_token(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    started = _mock_setup(monkeypatch)

    result = main(
        [
            "worker",
            "setup",
            "mac-mps",
            "--server",
            "https://example.test",
            "--device",
            "mps",
        ]
    )

    assert result == 0
    assert load_profile("mac-mps").token == "secret"
    assert started == ["mac-mps"]
    assert "secret" not in capsys.readouterr().out


def test_setup_keeps_existing_profile_when_preflight_fails(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            server_url="https://old.example.test",
            token="old-secret",
        ),
    )
    _at_a_terminal(monkeypatch, lambda _prompt: "new-secret")
    monkeypatch.setattr(worker_command, "require_launchd", lambda: None)

    def fail_preflight(_name, _profile):
        raise ValueError("unreachable")

    monkeypatch.setattr(worker_command, "preflight_profile", fail_preflight)
    monkeypatch.setattr(
        worker_command,
        "start_service",
        lambda _name: pytest.fail("invalid profile must not start"),
    )

    result = main(
        [
            "worker",
            "setup",
            "trainer",
            "--server",
            "https://new.example.test",
            "--force",
        ]
    )

    assert result == 2
    assert load_profile("trainer").server_url == "https://old.example.test"
    assert load_profile("trainer").token == "old-secret"
    assert "unreachable" in capsys.readouterr().err


def test_setup_restarts_a_replaced_profile(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            server_url="https://old.example.test",
            token="old-secret",
        ),
    )
    monkeypatch.setattr(worker_command, "require_launchd", lambda: None)
    _at_a_terminal(monkeypatch, lambda _prompt: "new-secret")
    monkeypatch.setattr(worker_command, "preflight_profile", lambda *_args: ())
    restarted: list[str] = []
    monkeypatch.setattr(worker_command, "restart_service", restarted.append)
    monkeypatch.setattr(
        worker_command,
        "start_service",
        lambda _name: pytest.fail("a replaced service must be restarted"),
    )

    assert (
        main(
            [
                "worker",
                "setup",
                "trainer",
                "--server",
                "https://new.example.test",
                "--force",
            ]
        )
        == 0
    )
    assert restarted == ["trainer"]
    assert load_profile("trainer").token == "new-secret"


def test_setup_rejects_an_existing_profile_before_prompting(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            server_url="https://example.test",
            token="secret",
        ),
    )
    _at_a_terminal(
        monkeypatch,
        lambda _prompt: pytest.fail("existing profile must fail before prompting"),
    )

    assert (
        main(
            [
                "worker",
                "setup",
                "trainer",
                "--server",
                "https://example.test",
            ]
        )
        == 2
    )
    assert "already exists" in capsys.readouterr().err


def test_setup_without_a_service_saves_the_profile_a_program_pipes_the_token_for(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    monkeypatch.setattr(worker_command.sys, "stdin", io.StringIO("piped-secret\n"))
    monkeypatch.setattr(
        worker_command,
        "require_launchd",
        lambda: pytest.fail("a profile without a service needs no launchd"),
    )
    monkeypatch.setattr(
        worker_command,
        "preflight_profile",
        lambda name, _profile: (f"profile: {name}",),
    )
    monkeypatch.setattr(
        worker_command,
        "start_service",
        lambda _name: pytest.fail("no service is started"),
    )

    result = main(
        [
            "worker",
            "setup",
            "hosted",
            "--server",
            "https://example.test",
            "--no-service",
        ]
    )

    assert result == 0
    assert load_profile("hosted").token == "piped-secret"
    assert "piped-secret" not in capsys.readouterr().out


def test_setup_again_without_a_service_replaces_the_profile_and_restarts_nothing(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    save_profile(
        "hosted", WorkerProfile(server_url="https://example.test", token="revoked")
    )
    monkeypatch.setattr(worker_command.sys, "stdin", io.StringIO("reissued\n"))
    monkeypatch.setattr(worker_command, "preflight_profile", lambda _name, _profile: ())
    for service in ("require_launchd", "start_service", "restart_service"):
        monkeypatch.setattr(
            worker_command,
            service,
            lambda *_args: pytest.fail("a profile without a service has none"),
        )

    result = main(
        [
            "worker",
            "setup",
            "hosted",
            "--server",
            "https://example.test",
            "--no-service",
            "--force",
        ]
    )

    assert result == 0
    assert load_profile("hosted").token == "reissued"


def test_list_reports_each_profile(tmp_path, monkeypatch, capsys) -> None:
    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            server_url="https://example.test",
            token="secret",
        ),
    )

    assert main(["worker", "list"]) == 0

    assert capsys.readouterr().out == ("trainer\tnever started\tnot loaded\tcpu\n")


@pytest.mark.parametrize("action", ["start", "restart", "stop"])
def test_service_commands_check_platform_and_profile_once(
    tmp_path, monkeypatch, action
):
    from seedctl.worker.host import launchd

    monkeypatch.setenv("SEEDBUDDY_HOME", str(tmp_path))
    profile = WorkerProfile(server_url="https://example.test", token="secret")
    save_profile("trainer", profile)
    checks = []
    loads = []
    monkeypatch.setattr(
        worker_command, "require_launchd", lambda: checks.append("platform")
    )
    original = worker_command.load_profile

    def load(name):
        loads.append(name)
        return original(name)

    monkeypatch.setattr(worker_command, "load_profile", load)
    monkeypatch.setattr(
        worker_command,
        "preflight_profile",
        lambda name, value: (checks.append(value) or "ready",),
    )
    monkeypatch.setattr(
        launchd, "launch_agent_path", lambda _: tmp_path / "agent.plist"
    )
    monkeypatch.setattr(launchd.shutil, "which", lambda _: "/opt/bin/seedctl")
    monkeypatch.setattr(launchd, "service_loaded", lambda _: False)
    monkeypatch.setattr(launchd, "_launchctl", lambda *args: None)
    assert main(["worker", action, "trainer"]) == 0
    assert loads == ["trainer"]
    assert checks == (["platform"] if action == "stop" else ["platform", profile])
