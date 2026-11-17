from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
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


def test_runtime_probe_reserves_stdout_for_its_json_response(monkeypatch, capsys):
    from seedctl.cli import main
    from seedctl.worker.host import command

    def describe():
        print("Creating runtime settings")
        print("Runtime diagnostic", file=sys.stderr)
        return {"hostProtocol": 1}

    monkeypatch.setattr(command, "runtime_description", describe)
    assert main(["worker", "runtime"]) == 0
    response = capsys.readouterr()
    assert json.loads(response.out) == {"hostProtocol": 1}
    assert response.err == "Creating runtime settings\nRuntime diagnostic\n"


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
    monkeypatch.setenv("SEEDBUDDY_HOST_RUN", "current-launch")
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
        states.append(status())
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
        {"state": state, "pid": os.getpid(), "hostRun": "current-launch"}
        for state in ("starting", "running", "training", "running")
    ]
    assert status() == {
        "state": "stopped",
        "pid": os.getpid(),
        "hostRun": "current-launch",
    }


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
    monkeypatch.setenv("SEEDBUDDY_HOST_RUN", "refused-launch")
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
    assert status == {
        "state": state,
        "detail": str(refusal),
        "pid": os.getpid(),
        "hostRun": "refused-launch",
    }


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


def _hosted(directory: Path, then: str, *, grace: float) -> subprocess.Popen[bytes]:
    """A process that waits to be stopped as a hosted Worker does, and then does `then`."""
    script = f"""
import sys
import time
from pathlib import Path

import seedctl.worker.host.runtime as runtime

runtime.HOSTED_GRACE_SECONDS = {grace}
with runtime.running_profile(Path({str(directory)!r}), hosted=True) as control:
    print("serving", flush=True)
    control.stopped.wait()
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


def test_a_hosted_process_stops_when_its_host_closes_its_standard_input(
    tmp_path,
) -> None:
    process = _hosted(tmp_path, "sys.exit(7)", grace=30)
    assert process.poll() is None

    assert _let_go(process) == 7


def test_a_hosted_process_that_does_not_finish_in_time_ends_itself(tmp_path) -> None:
    process = _hosted(tmp_path, "time.sleep(600)", grace=0.2)

    assert _let_go(process) == 1


@pytest.mark.parametrize("command", [b"", b"drain\n"])
def test_hosted_worker_can_return_before_its_host_closes_stdin(command, tmp_path):
    script = """
import time
import sys
from pathlib import Path
from seedctl.worker.host.runtime import running_profile
with running_profile(Path(sys.argv[2]), hosted=True) as control:
    print('ready', flush=True)
    if __import__('sys').argv[1] == 'drain':
        assert control.draining.wait(5)
        assert not control.stopped.is_set()
    else:
        time.sleep(0.2)
"""
    with subprocess.Popen(
        [sys.executable, "-c", script, "drain" if command else "return", str(tmp_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    ) as process:
        assert (
            process.stdout is not None
            and process.stdin is not None
            and process.stderr is not None
        )
        assert process.stdout.readline().strip() == b"ready"
        if command:
            process.stdin.write(command)
            process.stdin.flush()
        # Keep the input pipe open through interpreter finalization.
        assert process.wait(timeout=10) == 0, process.stderr.read().decode()


def _execution_with_descendant(heartbeat: str) -> None:
    subprocess.Popen(
        [
            sys.executable,
            "-c",
            """
import pathlib, signal, sys, time
from seedctl.worker.host.lock import _try_lock
path = pathlib.Path(sys.argv[1])
resource = path.with_suffix('.lock').open('a+b')
assert _try_lock(resource)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
while True:
    with path.open('ab') as stream:
        stream.write(b'.')
    time.sleep(0.01)
""",
            heartbeat,
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + 10
    while not Path(heartbeat).exists():
        if time.monotonic() > deadline:
            raise RuntimeError("Descendant did not start")
        time.sleep(0.01)


def test_execution_scope_reaps_descendants_after_the_root_exits(tmp_path):
    from seedctl.worker.process import ProcessScope

    heartbeat = tmp_path / "heartbeat"
    with ProcessScope() as processes:
        child = processes.start(
            _execution_with_descendant, (str(heartbeat),), name="exited-root"
        )
        deadline = time.monotonic() + 10
        while child.is_alive():
            assert time.monotonic() < deadline
            time.sleep(0.01)
        assert heartbeat.exists()
    size = heartbeat.stat().st_size
    from seedctl.worker.host.lock import _try_lock

    with heartbeat.with_suffix(".lock").open("a+b") as resource:
        # Windows lets go of an ended process's locks in its own time.
        deadline = time.monotonic() + 5
        while not _try_lock(resource):
            assert time.monotonic() < deadline
            time.sleep(0.01)
    time.sleep(0.1)
    assert heartbeat.stat().st_size == size


def test_host_timeout_reaps_execution_before_releasing_the_profile(tmp_path):
    script = """
import sys, time
sys.path.insert(0, sys.argv[1])
from pathlib import Path
from test_worker_host import _execution_with_descendant
from seedctl.worker.host.runtime import running_profile
import seedctl.worker.host.runtime as runtime
runtime.HOSTED_GRACE_SECONDS = 0.2
with running_profile(Path(sys.argv[2]), hosted=True) as control:
    child = control.processes.start(_execution_with_descendant, (sys.argv[3],), name='execution')
    while child.is_alive():
        time.sleep(0.01)
    print('ready', flush=True)
    time.sleep(600)  # the serving thread is blocked while the host disappears
"""
    heartbeat = tmp_path / "heartbeat"
    with subprocess.Popen(
        [
            sys.executable,
            "-c",
            script,
            str(Path(__file__).parent),
            str(tmp_path),
            str(heartbeat),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    ) as process:
        assert process.stdout is not None and process.stdin is not None
        assert process.stdout.readline().strip() == b"ready"
        process.stdin.close()
        assert process.wait(timeout=10) == 1
    with running_alone(tmp_path, threading.Event(), wait=0):
        size = heartbeat.stat().st_size
        time.sleep(0.1)
        assert heartbeat.stat().st_size == size


def test_blocked_image_download_retains_profile_until_forced_exit(tmp_path):
    script = """
import sys, threading
from pathlib import Path
from seedctl.worker.images import ImageCache
import seedctl.worker.host.runtime as runtime
runtime.HOSTED_GRACE_SECONDS = 0.5
with runtime.running_profile(Path(sys.argv[1]), hosted=True) as control:
    images = ImageCache(Path(sys.argv[1]) / 'images')
    started = threading.Event()
    def download(_digest):
        started.set()
        threading.Event().wait()
    images.fetch('a' * 64, download)
    assert started.wait(5)
    print('ready', flush=True)
    control.stopped.wait()
    print('closing', flush=True)
    images.close()
"""
    with subprocess.Popen(
        [sys.executable, "-c", script, str(tmp_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    ) as process:
        assert process.stdin is not None and process.stdout is not None
        try:
            assert process.stdout.readline().strip() == b"ready"
            process.stdin.close()
            assert process.stdout.readline().strip() == b"closing"
            with (
                pytest.raises(RuntimeError, match="another process"),
                running_alone(tmp_path, threading.Event(), wait=0),
            ):
                pass
            assert process.wait(timeout=10) == 1
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
    with running_alone(tmp_path, threading.Event(), wait=0):
        pass


@pytest.mark.parametrize("blocked", [False, True])
def test_cleanup_failure_keeps_ownership_and_does_not_cancel_supervision(
    tmp_path, blocked
):
    script = """
import sys, time
from pathlib import Path
from seedctl.worker.host.lock import _try_lock
import seedctl.worker.host.runtime as runtime
runtime.HOSTED_GRACE_SECONDS = 0.2
directory = Path(sys.argv[1])
with runtime.running_profile(directory, hosted=True) as control:
    child = control.processes.start(time.sleep, (60,), name='execution')
    close = child.close
    calls = 0
    def failing_once():
        global calls
        calls += 1
        with (directory / 'run.lock').open('a+b') as handle:
            assert not _try_lock(handle), 'profile released before cleanup'
        if calls == 1:
            raise OSError('injected cleanup failure')
        close()
    child.close = failing_once
    print('ready', flush=True)
    control.stopped.wait()
    if sys.argv[2] == 'blocked':
        time.sleep(600)
"""
    with subprocess.Popen(
        [
            sys.executable,
            "-c",
            script,
            str(tmp_path),
            "blocked" if blocked else "return",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    ) as process:
        assert (
            process.stdout is not None
            and process.stdin is not None
            and process.stderr is not None
        )
        try:
            assert process.stdout.readline().strip() == b"ready"
            process.stdin.close()
            assert process.wait(timeout=10) == (1 if blocked else 0)
            diagnostic = process.stderr.read().decode()
            assert "injected cleanup failure" in diagnostic
            assert "profile released before cleanup" not in diagnostic
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def test_serving_cleanup_failure_returns_to_the_owner_without_admitting_more_work(
    tmp_path, monkeypatch
):
    from seedctl.worker import service
    from seedctl.worker.host.runtime import running_profile
    from seedctl.worker.process import ExecutionCleanupError

    finished = []

    def publish():
        assert not child.is_alive()
        with (
            pytest.raises(RuntimeError, match="another process"),
            running_alone(tmp_path, threading.Event(), wait=0),
        ):
            pass
        finished.append(True)

    with running_profile(tmp_path, hosted=False, on_closed=publish) as control:
        child = control.processes.start(time.sleep, (60,), name="execution")
        close = child.close

        def failing_once():
            monkeypatch.setattr(child, "close", close)
            raise OSError("injected cleanup failure")

        monkeypatch.setattr(child, "close", failing_once)

        class Serving:
            def serve_once(self, *_args):
                control.processes.close_execution(child)
                pytest.fail("Serving must not retry a lifecycle failure")

            def close(self):
                pass

        monkeypatch.setattr(service, "Worker", lambda *_args, **_kwargs: Serving())
        settings = WorkerSettings(
            "https://example.test", "unused", tmp_path, poll_seconds=0.01, device=None
        )
        with pytest.raises(ExecutionCleanupError):
            service.run_worker(
                settings, control, on_ready=lambda: None, on_training=lambda _: None
            )
        assert child.is_alive() and not control.stopped.is_set()
        with pytest.raises(ExecutionCleanupError, match="not accepting"):
            control.processes.start(time.sleep, (60,), name="replacement")
        assert finished == []
    assert finished == [True]
    with running_alone(tmp_path, threading.Event(), wait=0):
        pass


def test_failed_profile_acquisition_cannot_publish_another_owners_terminal_status(
    tmp_path,
):
    from seedctl.worker.host.runtime import running_profile

    published = []
    with (
        running_alone(tmp_path, threading.Event(), wait=0),
        pytest.raises(RuntimeError, match="another process"),
        running_profile(
            tmp_path, hosted=False, on_closed=lambda: published.append(True)
        ),
    ):
        pytest.fail("The profile is already owned")
    assert published == []
