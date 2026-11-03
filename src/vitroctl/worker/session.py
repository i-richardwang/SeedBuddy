"""What every Worker process is to the workbench: one session of one worker.

The token names the enrolled worker; the session names this process. A
session heartbeats what it can do, and the work it holds is a lease the
workbench fences by the session. Inference and training keep their own
protocols for the work itself.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx

from vitroctl.detectors.contract import RuntimeDescriptor
from vitroctl.detectors.traditional.config import PipelineConfig
from vitroctl.detectors.traditional.detector import TraditionalDetector
from vitroctl.detectors.traditional.scoring import DEFAULT_MODEL
from vitroctl.detectors.ultralytics.detector import ultralytics_runtime_descriptor
from vitroctl.detectors.ultralytics.runtime import ultralytics_installed
from vitroctl.worker.connection import (
    WorkerConnection,
    WorkerHttpClient,
    validate_worker_settings,
)

LEASE_REFRESH_SECONDS = 30.0


class LeaseLostError(RuntimeError):
    """The workbench no longer holds this session as the owner of its work."""


@dataclass(frozen=True)
class WorkerSettings:
    server_url: str
    token: str
    work_dir: Path
    poll_seconds: float = 5.0
    device: str | None = None

    def __post_init__(self) -> None:
        validate_worker_settings(
            self.server_url, self.token, self.poll_seconds, self.device
        )


def available_runtimes() -> tuple[RuntimeDescriptor, ...]:
    """The adapters this process executes; training needs the ultralytics one."""
    runtimes = [TraditionalDetector(PipelineConfig(), DEFAULT_MODEL).runtime]
    if ultralytics_installed():
        runtimes.append(ultralytics_runtime_descriptor())
    return tuple(runtimes)


def device_memory_bytes(device: str) -> int:
    """The memory the accelerator offers a claim or training run.

    Unified-memory Macs report Metal's recommended working set, CUDA devices
    their total memory, and the CPU the machine's physical memory.
    """
    if device == "cpu":
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    import torch

    if device == "mps":
        return int(torch.mps.recommended_max_memory())
    index = int(device.partition(":")[2] or "0")
    return int(torch.cuda.mem_get_info(index)[1])


@dataclass(frozen=True)
class WorkerSession:
    """One process incarnation of a worker and what it can do."""

    session_id: str
    started_at: str
    runtimes: tuple[RuntimeDescriptor, ...]
    memory_bytes: int

    @classmethod
    def create(cls, device: str | None) -> WorkerSession:
        return cls(
            f"session-{uuid4()}",
            datetime.now(UTC).isoformat(),
            available_runtimes(),
            device_memory_bytes(device or "cpu"),
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
            "memoryBytes": self.memory_bytes,
        }


class WorkerClient(WorkerHttpClient):
    """The workbench as one worker session sees it."""

    def __init__(
        self,
        server_url: str,
        token: str,
        session: WorkerSession,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        """transport is a test seam; production uses the default transport."""
        self.session = session
        super().__init__(
            WorkerConnection(server_url=server_url, token=token),
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


class Lease:
    """One lease a keeper renews, and whether it has been lost."""

    def __init__(self, renew: Callable[[], None]) -> None:
        self.renew = renew
        self.error: Exception | None = None

    @property
    def lost(self) -> bool:
        return self.error is not None


class LeaseKeeper:
    """
    Keeps every lease the session holds live from one thread. Each round
    renews the leases still held and heartbeats once; a lease whose renewal
    fails is lost on its own, while a failed heartbeat loses them all, since
    the session itself may be gone.
    """

    def __init__(self, client: WorkerClient) -> None:
        self.client = client
        self._lock = threading.Lock()
        self._leases: set[Lease] = set()
        self._closed = threading.Event()
        self._thread: threading.Thread | None = None

    def hold(self, renew: Callable[[], None]) -> Lease:
        """Renew once now, so a claim that is already lost fails here."""
        renew()
        lease = Lease(renew)
        with self._lock:
            self._leases.add(lease)
            if self._thread is None:
                self._thread = threading.Thread(
                    target=self._refresh, name="worker-lease", daemon=True
                )
                self._thread.start()
        return lease

    def end(self, lease: Lease) -> None:
        """Stop renewing the lease; a renewal that failed surfaces here."""
        with self._lock:
            self._leases.discard(lease)
        if lease.error is not None:
            raise LeaseLostError("Lease refresh failed") from lease.error

    def close(self) -> None:
        self._closed.set()
        if self._thread is not None:
            self._thread.join()

    def _refresh(self) -> None:
        while not self._closed.wait(LEASE_REFRESH_SECONDS):
            with self._lock:
                held = [lease for lease in self._leases if not lease.lost]
            if not held:
                continue
            for lease in held:
                try:
                    lease.renew()
                except Exception as error:  # noqa: BLE001 - the lease owns its loss
                    lease.error = error
            try:
                self.client.heartbeat()
            except Exception as error:  # noqa: BLE001 - every lease shares the session
                for lease in held:
                    lease.error = lease.error or error


@contextmanager
def keep_lease(
    client: WorkerClient,
    renew: Callable[[], None],
    *,
    cancelled: Callable[[], bool],
) -> Iterator[Callable[[], bool]]:
    """
    Keep one lease live while the work runs. The caller polls the yielded
    predicate and stops when the lease is lost or the process is shutting
    down; leaving surfaces a lost lease.
    """
    keeper = LeaseKeeper(client)
    try:
        lease = keeper.hold(renew)
        try:
            yield lambda: lease.lost or cancelled()
        finally:
            keeper.end(lease)
    finally:
        keeper.close()
