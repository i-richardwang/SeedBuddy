"""Worker HTTP connections accept a transport for tests; production uses HTTPX defaults."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx

from vitroctl.contracts.identifiers import WORKER_DEVICE

RETRYABLE_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})


@dataclass(frozen=True, slots=True, kw_only=True)
class WorkerConnection:
    server_url: str
    token: str

    def __post_init__(self) -> None:
        if not self.server_url.startswith(("http://", "https://")):
            raise ValueError("worker server URL must use http or https")
        if not self.token:
            raise ValueError("worker token is required")

    @property
    def base_url(self) -> str:
        return self.server_url.rstrip("/") + "/"


def validate_worker_settings(
    server_url: str, token: str, poll_seconds: float, device: str | None
) -> None:
    WorkerConnection(server_url=server_url, token=token)
    if poll_seconds <= 0:
        raise ValueError("poll interval must be positive")
    if device is not None and not WORKER_DEVICE.fullmatch(device):
        raise ValueError("device must be cpu, mps, cuda, or cuda:<index>")


class WorkerNotEnrolledError(Exception):
    """
    The workbench refused the token: the worker was removed or never
    enrolled. Retrying cannot help, so this ends the process rather than
    joining the errors a worker loop recovers from.
    """

    def __init__(self) -> None:
        super().__init__(
            "the workbench does not recognize this worker's token; enroll the "
            "worker on the Status page and set it up again with the token it shows"
        )


class WorkerHttpClient:
    def __init__(
        self,
        connection: WorkerConnection,
        *,
        timeout: float = 120.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._client = httpx.Client(
            base_url=connection.base_url,
            headers={"Authorization": f"Bearer {connection.token}"},
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def request(
        self, method: str, url: str, *, deadline: float | None = None, **kwargs: Any
    ) -> httpx.Response:
        for attempt in range(3):
            try:
                if deadline is None:
                    response = self._client.request(method, url, **kwargs)
                else:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise httpx.TimeoutException("Request deadline exceeded")
                    bounded = {**kwargs, "timeout": min(5.0, remaining)}
                    with self._client.stream(method, url, **bounded) as stream:
                        chunks = []
                        for chunk in stream.iter_bytes():
                            if time.monotonic() >= deadline:
                                raise httpx.TimeoutException(
                                    "Response deadline exceeded"
                                )
                            chunks.append(chunk)
                        response = httpx.Response(
                            stream.status_code,
                            headers=[
                                (key, value)
                                for key, value in stream.headers.multi_items()
                                if key.lower()
                                not in {"content-encoding", "content-length"}
                            ],
                            content=b"".join(chunks),
                            request=stream.request,
                        )
                    if time.monotonic() >= deadline:
                        raise httpx.TimeoutException("Request deadline exceeded")
            except httpx.TransportError:
                if attempt == 2:
                    raise
            else:
                if response.status_code == 401:
                    response.close()
                    raise WorkerNotEnrolledError
                if response.status_code not in RETRYABLE_STATUS_CODES or attempt == 2:
                    return response
                response.close()
            delay = 0.5 * 2**attempt
            if deadline is not None:
                delay = min(delay, max(0, deadline - time.monotonic()))
            time.sleep(delay)
        raise RuntimeError("HTTP retry loop ended without a response")
