"""The server-owned inference attempt and its fenced HTTP protocol."""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from vitroctl.contracts.validation import outbound, validate_wire_contract
from vitroctl.worker.model_store import ModelManifest
from vitroctl.worker.session import WorkerClient


def timestamp(value: str) -> float:
    return datetime.fromisoformat(value).timestamp()


@dataclass(frozen=True)
class Assignment:
    manifest: ModelManifest
    image: str
    attempt: int
    lease_expires_at: str
    deadline_at: str
    server_time: str

    @classmethod
    def from_document(cls, value: Any, context: str = "assignment") -> Assignment:
        validate_wire_contract("inference-assignment", value, context)
        return cls.decode(value, context)

    @classmethod
    def decode(cls, value: Any, context: str) -> Assignment:
        result = cls(
            ModelManifest.decode(value["manifest"], f"{context}.manifest"),
            value["image"],
            value["attempt"],
            value["leaseExpiresAt"],
            value["deadlineAt"],
            value["serverTime"],
        )
        if (
            not timestamp(result.server_time)
            < timestamp(result.lease_expires_at)
            <= timestamp(result.deadline_at)
        ):
            raise ValueError(f"{context} has invalid execution deadlines")
        return result

    @property
    def version_id(self) -> str:
        return self.manifest.model_version_id


class InferenceClient:
    def __init__(self, worker: WorkerClient) -> None:
        self.worker = worker

    def identity(self, assignment: Assignment) -> dict[str, str | int]:
        return {**self.worker.identity, "attempt": assignment.attempt}

    def claim(self) -> Assignment | None:
        response = self.worker.request(
            "POST",
            "api/worker/inference/claim",
            json=self.worker.identity,
            deadline=time.monotonic() + 20,
        )
        response.raise_for_status()
        assignment = response.json()["assignment"]
        return None if assignment is None else Assignment.from_document(assignment)

    def weights(self, version_id: str, deadline: float) -> bytes:
        response = self.worker.request(
            "GET",
            f"api/worker/inference/model-versions/{version_id}/weights",
            deadline=deadline,
        )
        response.raise_for_status()
        return response.content

    def download(self, digest: str, deadline: float) -> bytes:
        response = self.worker.request(
            "GET", f"api/worker/inference/images/{digest}", deadline=deadline
        )
        response.raise_for_status()
        return response.content

    def renew(self, assignment: Assignment, deadline: float) -> dict[str, str]:
        response = self.worker.request(
            "POST",
            f"api/worker/inference/claims/{assignment.version_id}/{assignment.image}/lease",
            json=self.identity(assignment),
            deadline=deadline,
        )
        self.worker.require_current_session(response)
        return response.json()

    def heartbeat(self, deadline: float) -> None:
        self.worker.heartbeat(deadline=deadline)

    def put_result(
        self, assignment: Assignment, document: dict[str, Any], deadline: float
    ) -> None:
        document = outbound("detection-result", document)
        response = self.worker.request(
            "PUT",
            f"api/worker/inference/results/{assignment.version_id}/{assignment.image}",
            params=self.identity(assignment),
            json=document,
            deadline=deadline,
        )
        self.worker.require_current_session(response)

    def fail(
        self, assignment: Assignment, code: str, message: str, deadline: float
    ) -> None:
        response = self.worker.request(
            "POST",
            f"api/worker/inference/claims/{assignment.version_id}/{assignment.image}/fail",
            json={
                **self.identity(assignment),
                "failure": {"code": code, "message": message[:2000] or code},
            },
            deadline=deadline,
        )
        self.worker.require_current_session(response)
