"""The operator HTTP surface used by CLI model and training commands."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

from vitroctl.contracts.validation import outbound


class WorkbenchClient:
    def __init__(self, server: str, token: str):
        self.server = server.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}"}

    def call(self, operation: str, arguments: dict[str, Any]) -> Any:
        response = httpx.post(
            f"{self.server}/api/agent/{operation}",
            json=arguments,
            headers=self.headers,
            timeout=120,
        )
        response.raise_for_status()
        return response.json()["result"]

    def import_bundle(self, document: dict[str, Any], weights: Path, model: str) -> Any:
        reservation = self.call(
            "prepare-model-upload",
            {"model": model, "bundle": outbound("model-bundle", document)},
        )
        # The response's path is informative; credentials only go to the configured origin.
        upload_id = reservation["uploadId"]
        if (
            not isinstance(upload_id, str)
            or not upload_id.startswith("upload-")
            or not all(c.isalnum() or c == "-" for c in upload_id)
        ):
            raise ValueError("Invalid model upload identity")
        with weights.open("rb") as stream:
            response = httpx.put(
                f"{self.server}/api/agent/model-uploads/{upload_id}/weights",
                content=stream,
                headers={
                    **self.headers,
                    "Content-Type": "application/octet-stream",
                    "Content-Length": str(weights.stat().st_size),
                },
                timeout=300,
            )
        response.raise_for_status()
        return self.call("register-model-upload", {"uploadId": upload_id})
