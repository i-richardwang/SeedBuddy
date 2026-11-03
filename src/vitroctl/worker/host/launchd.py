from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from vitroctl.io.files import atomic_file
from vitroctl.worker.host.profiles import (
    load_profile,
    profile_directory,
    validate_profile_name,
    worker_home,
)

LABEL_PREFIX = "com.vitroflow.worker"
# A stopping Worker leaves training at the next batch; the margin keeps it
# from being killed while it writes an epoch checkpoint.
EXIT_TIMEOUT_SECONDS = 60


def service_label(name: str) -> str:
    return f"{LABEL_PREFIX}.{validate_profile_name(name)}"


def launch_agent_path(name: str) -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{service_label(name)}.plist"


def launch_agent_document(name: str, executable: str | None = None) -> dict[str, Any]:
    command = executable or shutil.which("vitroctl")
    if not command:
        raise RuntimeError("vitroctl executable is not available on PATH")
    directory = profile_directory(name)
    return {
        "Label": service_label(name),
        "ProgramArguments": [command, "worker", "run", name],
        "RunAtLoad": True,
        # Restarted after a crash; a worker that stopped on purpose, because
        # it was shut down or is no longer enrolled, stays down.
        "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 10,
        "ExitTimeOut": EXIT_TIMEOUT_SECONDS,
        "WorkingDirectory": str(directory),
        "EnvironmentVariables": {"VITROFLOW_HOME": str(worker_home())},
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def require_launchd() -> None:
    if sys.platform != "darwin":
        raise RuntimeError("native worker services currently require macOS launchd")


def install_launch_agent(name: str) -> Path:
    require_launchd()
    load_profile(name)
    path = launch_agent_path(name)
    with atomic_file(path) as handle:
        handle.write(plistlib.dumps(launch_agent_document(name), sort_keys=True))
    return path


def _service_target(name: str) -> str:
    return f"gui/{os.getuid()}/{service_label(name)}"


def _launchctl(*arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["launchctl", *arguments],
        check=check,
        capture_output=True,
        text=True,
    )


def service_loaded(name: str) -> bool:
    if sys.platform != "darwin":
        return False
    return _launchctl("print", _service_target(name), check=False).returncode == 0


def start_service(name: str) -> None:
    path = install_launch_agent(name)
    if service_loaded(name):
        _launchctl("kickstart", _service_target(name))
    else:
        _launchctl("bootstrap", f"gui/{os.getuid()}", str(path))


def stop_service(name: str) -> None:
    """Stop the Worker; `bootout` returns before launchd has let the process go."""
    require_launchd()
    load_profile(name)
    if not service_loaded(name):
        return
    _launchctl("bootout", _service_target(name))
    deadline = time.monotonic() + EXIT_TIMEOUT_SECONDS + 5
    while service_loaded(name):
        if time.monotonic() > deadline:
            raise RuntimeError(f"Worker {name} did not stop")
        time.sleep(0.5)


def restart_service(name: str) -> None:
    """Replace the Worker with one that runs under its current definition."""
    stop_service(name)
    start_service(name)
