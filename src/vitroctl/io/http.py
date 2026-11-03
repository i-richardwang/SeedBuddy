"""Authenticated HTTP connections to a configured workbench."""

import httpx


def authorized_client(
    server_url: str,
    token: str,
    *,
    timeout: float | httpx.Timeout,
    transport: httpx.BaseTransport | None = None,
) -> httpx.Client:
    return httpx.Client(
        base_url=server_url.rstrip("/") + "/",
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
        transport=transport,
    )
