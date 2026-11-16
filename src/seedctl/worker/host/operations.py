from __future__ import annotations

import json
import logging
import os
import time
from collections import deque

from seedctl.io.files import write_text_atomically
from seedctl.worker.connection import (
    WorkerConnection,
    WorkerHttpClient,
    WorkerNotEnrolledError,
    WorkerProtocolError,
    WorkerRefusedError,
    WorkerSuspendedError,
)
from seedctl.worker.host.launchd import service_loaded
from seedctl.worker.host.lock import running_alone
from seedctl.worker.host.logging import profile_logging
from seedctl.worker.host.profiles import (
    WorkerProfile,
    load_profile,
    profile_directory,
)
from seedctl.worker.process import process_exists
from seedctl.worker.runtime import HOSTED_HANDOVER_SECONDS, shutdown_requests
from seedctl.worker.service import run_worker
from seedctl.worker.session import available_runtimes

LOGGER = logging.getLogger(__name__)

# The states of a process at work, as against the ones it leaves behind.
_SERVING = frozenset({"starting", "running", "training"})


def _check_device(device: str | None) -> None:
    if device is None or device == "cpu":
        return
    try:
        import torch
    except ImportError as error:
        raise RuntimeError("device validation requires seedctl[yolo]") from error
    if device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS is not available on this machine")
    if device.startswith("cuda"):
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is not available on this machine")
        index = int(device.partition(":")[2] or "0")
        if index >= torch.cuda.device_count():
            raise RuntimeError(f"CUDA device {index} is not available")


def _enrolled_worker(profile: WorkerProfile) -> str:
    """
    The worker the workbench enrolled this profile's token for. A workbench
    that turns the worker away fails the check, as any other finding does.
    """
    client = WorkerHttpClient(
        WorkerConnection(server_url=profile.server_url, token=profile.token),
        timeout=30,
    )
    try:
        response = client.request("GET", "api/worker/ready")
        response.raise_for_status()
        return str(response.json()["workerId"])
    except WorkerRefusedError as error:
        raise RuntimeError(str(error)) from error
    finally:
        client.close()


def preflight_profile(name: str, profile: WorkerProfile) -> tuple[str, ...]:
    settings = profile.settings(name)
    work = settings.work_dir
    work.mkdir(parents=True, exist_ok=True)
    if not os.access(work, os.W_OK):
        raise PermissionError(f"worker directory is not writable: {work}")
    worker = _enrolled_worker(profile)
    checks = [
        f"profile: {name}",
        f"server: {profile.server_url}",
        f"worker: {worker}",
        f"work directory: {work}",
    ]
    adapters = [runtime.adapter for runtime in available_runtimes()]
    runtimes = [
        f"ultralytics ({profile.device})"
        if adapter == "ultralytics" and profile.device
        else adapter
        for adapter in adapters
    ]
    checks.append(f"runtimes: {', '.join(runtimes)}")
    _check_device(profile.device)
    if profile.device:
        checks.append(f"device: {profile.device}")
    return tuple(checks)


def doctor_profile(name: str) -> tuple[str, ...]:
    return preflight_profile(name, load_profile(name))


def _write_status(name: str, state: str, *, detail: str | None = None) -> None:
    """
    Records what the process is doing, with the process that is doing it, or
    how it left off, and why when it failed.
    """
    path = profile_directory(name) / "status.json"
    document: dict[str, object] = {"state": state}
    if state in _SERVING:
        document["pid"] = os.getpid()
    if detail:
        document["detail"] = detail
    write_text_atomically(path, json.dumps(document, indent=2) + "\n")


def _stop_refused(name: str, state: str, refusal: Exception) -> int:
    """
    Records why the workbench turned the worker away. Exiting cleanly keeps
    launchd from restarting a worker that can only be refused again.
    """
    LOGGER.error("worker stopped: %s", refusal)
    _write_status(name, state, detail=str(refusal))
    return 0


def run_profile(name: str, *, hosted: bool = False) -> int:
    """
    Runs the profile until the process is asked to stop. A hosted process is
    the child of a program that stops it by closing its standard input, and
    waits for the process that program hosted before it to end.
    """
    directory = profile_directory(name)
    directory.mkdir(parents=True, exist_ok=True)
    wait = HOSTED_HANDOVER_SECONDS if hosted else 0
    with (
        shutdown_requests(hosted=hosted) as stopped,
        running_alone(directory, stopped, wait=wait),
        profile_logging(directory / "worker.log"),
    ):
        _write_status(name, "starting")
        try:
            profile = load_profile(name)

            def ready() -> None:
                _write_status(name, "running")

            def training(active: bool) -> None:
                _write_status(name, "training" if active else "running")

            run_worker(
                profile.settings(name),
                stopped,
                on_ready=ready,
                on_training=training,
            )
        except WorkerNotEnrolledError as error:
            return _stop_refused(name, "unenrolled", error)
        except WorkerSuspendedError as error:
            return _stop_refused(name, "suspended", error)
        except WorkerProtocolError as error:
            return _stop_refused(name, "incompatible", error)
        except Exception as error:
            LOGGER.exception("worker stopped after an error")
            _write_status(name, "failed", detail=str(error))
            return 1
        _write_status(name, "stopped")
        return 0


def _read_status(name: str) -> dict[str, object] | None:
    path = profile_directory(name) / "status.json"
    if not path.is_file():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else None


def _serving(pid: object) -> bool:
    """Whether the process a status names is still there."""
    return isinstance(pid, int) and process_exists(pid)


def profile_summary(name: str) -> str:
    """
    One line per profile. A process that is killed outright never records how
    it left off, so a status of work under way whose process is gone reads as
    stale.
    """
    profile = load_profile(name)
    status = _read_status(name)
    state = str(status.get("state")) if status else "never started"
    if status and state in _SERVING and not _serving(status.get("pid")):
        state = "stale"
    if status and status.get("detail"):
        state = f"{state}: {status['detail']}"
    device = profile.device or "cpu"
    service = "loaded" if service_loaded(name) else "not loaded"
    return f"{name}\t{state}\t{service}\t{device}"


def tail_log(name: str, *, lines: int, follow: bool) -> None:
    if lines <= 0:
        raise ValueError("log line count must be positive")
    path = profile_directory(name) / "worker.log"
    if not path.exists():
        return
    handle = path.open(encoding="utf-8", errors="replace")
    try:
        for line in deque(handle, maxlen=lines):
            print(line, end="")
        while follow:
            line = handle.readline()
            if line:
                print(line, end="", flush=True)
                continue
            try:
                rotated = path.stat().st_ino != os.fstat(handle.fileno()).st_ino
            except FileNotFoundError:
                rotated = False
            if rotated:
                handle.close()
                handle = path.open(encoding="utf-8", errors="replace")
            else:
                time.sleep(0.25)
    finally:
        handle.close()
