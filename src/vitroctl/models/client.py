"""The operator HTTP surface used by CLI model and training commands."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from vitroctl.contracts.validation import outbound
from vitroctl.io.http import authorized_client


class WorkbenchClient:
    def __init__(self, server: str, token: str):
        self.server = server
        self.token = token

    def call(self, operation: str, arguments: dict[str, Any]) -> Any:
        with authorized_client(self.server, self.token, timeout=120) as client:
            response = client.post(f"api/agent/{operation}", json=arguments)
        response.raise_for_status()
        return response.json()["result"]

    def import_bundle(self, document: dict[str, Any], weights: Path, model: str) -> Any:
        reservation = self.call(
            "prepare-model-upload",
            {"model": model, "bundle": outbound("model-bundle", document)},
        )
        upload_id = reservation["uploadId"]
        if (
            not isinstance(upload_id, str)
            or not upload_id.startswith("upload-")
            or not all(c.isalnum() or c == "-" for c in upload_id)
        ):
            raise ValueError("Invalid model upload identity")
        with (
            authorized_client(self.server, self.token, timeout=300) as client,
            weights.open("rb") as stream,
        ):
            response = client.put(
                f"api/agent/model-uploads/{upload_id}/weights",
                content=stream,
                headers={
                    "Content-Type": "application/octet-stream",
                    "Content-Length": str(weights.stat().st_size),
                },
            )
        response.raise_for_status()
        return self.call("register-model-upload", {"uploadId": upload_id})
