"""Wire documents consumed by a training worker."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, cast

from vitroctl.contracts.annotation import AnnotationDocument
from vitroctl.contracts.annotation_set import AnnotatedImage, validate_annotation_set
from vitroctl.contracts.validation import validate_wire_contract
from vitroctl.training.recipe import TrainingRecipe

TrainingPhase = Literal["preparing", "training", "validating"]


@dataclass(frozen=True, slots=True, kw_only=True)
class TrainingCheckpoint:
    attempt: int
    epoch: int
    worker_id: str

    @classmethod
    def from_document(cls, checkpoint: dict[str, Any]) -> TrainingCheckpoint:
        return cls(
            attempt=checkpoint["attempt"],
            epoch=checkpoint["epoch"],
            worker_id=checkpoint["workerId"],
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class TrainingClaim:
    run_id: str
    model_id: str
    dataset_snapshot_id: str
    created_at: datetime
    attempt: int
    recipe: TrainingRecipe
    worker_id: str
    session_id: str
    lease_expires_at: datetime
    phase: TrainingPhase
    progress: float
    checkpoint: TrainingCheckpoint | None

    @classmethod
    def from_document(cls, value: Any, context: str = "training run") -> TrainingClaim:
        validate_wire_contract("training-run", value, context)
        state_context = f"{context}.state"
        state = value["state"]
        if state["status"] != "running":
            raise ValueError(f"{state_context}.status must be running")
        phase = state["phase"]
        progress = state["progress"]
        return cls(
            run_id=value["id"],
            model_id=value["modelId"],
            dataset_snapshot_id=value["datasetSnapshotId"],
            created_at=_timestamp(value["createdAt"], f"{context}.createdAt"),
            attempt=value["attempt"],
            recipe=TrainingRecipe.from_document(value["recipe"]),
            worker_id=state["workerId"],
            session_id=state["sessionId"],
            lease_expires_at=_timestamp(
                state["leaseExpiresAt"], f"{state_context}.leaseExpiresAt"
            ),
            phase=cast(TrainingPhase, phase),
            progress=progress,
            checkpoint=TrainingCheckpoint.from_document(value["checkpoint"])
            if value["checkpoint"] is not None
            else None,
        )


def _timestamp(value: Any, context: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"{context} must be an ISO-8601 timestamp") from error
    if parsed.tzinfo is None:
        raise ValueError(f"{context} must include a timezone")
    return parsed.astimezone(UTC)


@dataclass(frozen=True)
class SnapshotImage:
    digest: str
    width: int
    height: int
    split: str
    annotation: AnnotationDocument


@dataclass(frozen=True)
class TrainingSnapshot:
    id: str
    dataset_id: str
    model_id: str
    classes: tuple[str, ...]
    images: tuple[SnapshotImage, ...]

    @classmethod
    def from_document(cls, value: Any, context: str = "snapshot") -> TrainingSnapshot:
        validate_wire_contract("training-snapshot", value, context)
        images = tuple(
            _snapshot_image(raw, f"{context}.images[{index}]")
            for index, raw in enumerate(value["images"])
        )
        classes = tuple(value["classes"])
        validate_annotation_set(
            (
                AnnotatedImage(
                    image.digest,
                    image.width,
                    image.height,
                    {"annotation": image.annotation},
                )
                for image in images
            ),
            classes,
            context,
        )
        return cls(
            id=value["id"],
            dataset_id=value["datasetId"],
            model_id=value["modelId"],
            classes=classes,
            images=images,
        )


def _snapshot_image(value: Any, context: str) -> SnapshotImage:
    digest = value["digest"]
    annotation = AnnotationDocument.from_document(
        value["annotation"], f"{context}.annotation"
    )
    return SnapshotImage(
        digest=digest,
        width=value["width"],
        height=value["height"],
        split=value["split"],
        annotation=annotation,
    )
