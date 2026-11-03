"""Wire documents consumed by a training worker."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, cast

from vitroctl.contracts.annotation import AnnotationDocument
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
    def parse(cls, value: Any, context: str = "training run") -> TrainingClaim:
        validate_wire_contract("training-run", value, context)
        run = value
        state_context = f"{context}.state"
        state = run["state"]
        if state["status"] != "running":
            raise ValueError(f"{state_context}.status must be running")
        phase = state["phase"]
        progress = state["progress"]
        return cls(
            run_id=run["id"],
            model_id=run["modelId"],
            dataset_snapshot_id=run["datasetSnapshotId"],
            created_at=_timestamp(run["createdAt"], f"{context}.createdAt"),
            attempt=run["attempt"],
            recipe=TrainingRecipe.from_document(run["recipe"]),
            worker_id=state["workerId"],
            session_id=state["sessionId"],
            lease_expires_at=_timestamp(
                state["leaseExpiresAt"], f"{state_context}.leaseExpiresAt"
            ),
            phase=cast(TrainingPhase, phase),
            progress=progress,
            checkpoint=TrainingCheckpoint.from_document(run["checkpoint"])
            if run["checkpoint"] is not None
            else None,
        )


def _timestamp(value: Any, context: str) -> datetime:
    text = value
    try:
        parsed = datetime.fromisoformat(text)
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


def _snapshot_image(value: Any, context: str) -> SnapshotImage:
    entry = value
    digest = entry["digest"]
    annotation = AnnotationDocument.from_document(
        entry["annotation"], f"{context}.annotation"
    )
    if annotation.digest != digest:
        raise ValueError(f"{context}.annotation describes another image")
    width = entry["width"]
    height = entry["height"]
    if (annotation.width, annotation.height) != (width, height):
        raise ValueError(
            f"{context}.annotation is drawn on {annotation.width}x{annotation.height}, "
            f"not {width}x{height}"
        )
    return SnapshotImage(
        digest=digest,
        width=width,
        height=height,
        split=entry["split"],
        annotation=annotation,
    )


def parse_training_snapshot(value: Any, context: str = "snapshot") -> TrainingSnapshot:
    validate_wire_contract("training-snapshot", value, context)
    document = value
    images = tuple(
        _snapshot_image(raw, f"{context}.images[{index}]")
        for index, raw in enumerate(document["images"])
    )
    digests = [image.digest for image in images]
    if len(set(digests)) != len(digests):
        raise ValueError(f"{context} lists an image digest more than once")
    classes = tuple(document["classes"])
    if len(set(classes)) != len(classes):
        raise ValueError(f"{context}.classes must be unique")
    known = set(classes)
    for image in images:
        for instance in image.annotation.instances:
            if instance.class_name not in known:
                raise ValueError(
                    f"{context} annotation uses unknown class {instance.class_name}"
                )
    return TrainingSnapshot(
        id=document["id"],
        dataset_id=document["datasetId"],
        model_id=document["modelId"],
        classes=classes,
        images=images,
    )
