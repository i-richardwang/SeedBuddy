"""What every Worker process is to the workbench: one session of one worker.

The token names the enrolled worker; the session names this process. A
session heartbeats what it can do, and the work it holds is a lease the
workbench fences by the session. Inference and training keep their own
protocols for the work itself.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx

from seedctl.contracts.identifiers import WORKER_DEVICE
from seedctl.detectors.contract import RuntimeDescriptor
from seedctl.detectors.traditional.config import (
    DEFAULT_PIPELINE_CONFIG,
)
from seedctl.detectors.traditional.detector import TraditionalDetector
from seedctl.detectors.traditional.scoring import DEFAULT_MODEL
from seedctl.detectors.ultralytics.detector import ultralytics_runtime_descriptor
from seedctl.detectors.ultralytics.runtime import ultralytics_installed
from seedctl.worker.connection import (
    WorkerConnection,
    WorkerHttpClient,
)

DEFAULT_POLL_SECONDS = 5.0
LEASE_REFRESH_SECONDS = 30.0


class LeaseLostError(RuntimeError):
    """The workbench no longer holds this session as the owner of its work."""


@dataclass(frozen=True)
class WorkerSettings:
    server_url: str
    token: str
    work_dir: Path
    poll_seconds: float
    device: str | None

    def __post_init__(self) -> None:
        if not self.server_url.startswith(("http://", "https://")):
            raise ValueError("worker server URL must use http or https")
        if not self.token:
            raise ValueError("worker token is required")
        if self.poll_seconds <= 0:
            raise ValueError("poll interval must be positive")
        if self.device is not None and not WORKER_DEVICE.fullmatch(self.device):
            raise ValueError("device must be cpu, mps, cuda, or cuda:<index>")

    @property
    def connection(self) -> WorkerConnection:
        return WorkerConnection(server_url=self.server_url, token=self.token)


def available_runtimes() -> tuple[RuntimeDescriptor, ...]:
    """The adapters this process executes; training needs the ultralytics one."""
    runtimes = [TraditionalDetector(DEFAULT_PIPELINE_CONFIG, DEFAULT_MODEL).runtime]
    if ultralytics_installed():
        runtimes.append(ultralytics_runtime_descriptor())
    return tuple(runtimes)


@dataclass(frozen=True)
class WorkerSession:
    """One process incarnation of a worker and what it can do."""

    session_id: str
    started_at: str
    runtimes: tuple[RuntimeDescriptor, ...]

    @classmethod
    def create(cls) -> WorkerSession:
        return cls(
            f"session-{uuid4()}",
            datetime.now(UTC).isoformat(),
            available_runtimes(),
        )

    @property
    def identity(self) -> dict[str, str]:
        return {"sessionId": self.session_id}

    @property
    def can_train(self) -> bool:
        """Training runs on the ultralytics runtime; without it a worker only detects."""
        return any(runtime.adapter == "ultralytics" for runtime in self.runtimes)

    def heartbeat(self) -> dict[str, object]:
        return {
            **self.identity,
            "startedAt": self.started_at,
            "runtimes": [runtime.to_dict() for runtime in self.runtimes],
        }


class WorkerClient(WorkerHttpClient):
    """The workbench as one worker session sees it."""

    def __init__(
        self,
        connection: WorkerConnection,
        session: WorkerSession,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.session = session
        super().__init__(
            connection,
            transport=transport,
        )

    @property
    def identity(self) -> dict[str, str]:
        return self.session.identity

    def heartbeat(self, *, deadline: float | None = None) -> None:
        response = self.request(
            "POST",
            "api/worker/heartbeat",
            json=self.session.heartbeat(),
            deadline=deadline,
        )
        self.require_current_session(response)

    @staticmethod
    def require_current_session(response: httpx.Response) -> None:
        """A 409 means another session of this worker owns it or its work."""
        if response.status_code == 409:
            raise LeaseLostError(response.text)
        response.raise_for_status()


@contextmanager
def keep_lease(
    client: WorkerClient,
    renew: Callable[[], None],
    *,
    cancelled: Callable[[], bool],
) -> Iterator[Callable[[], bool]]:
    """Renew one lease and heartbeat until work ends or ownership is lost."""
    renew()
    closed = threading.Event()
    error: Exception | None = None

    def refresh() -> None:
        nonlocal error
        while not closed.wait(LEASE_REFRESH_SECONDS):
            try:
                renew()
                client.heartbeat()
            except Exception as failure:  # noqa: BLE001
                error = failure
                return

    thread = threading.Thread(target=refresh, name="worker-lease", daemon=True)
    thread.start()
    try:
        yield lambda: error is not None or cancelled()
    finally:
        closed.set()
        thread.join()
        if error is not None:
            raise LeaseLostError("Lease refresh failed") from error
