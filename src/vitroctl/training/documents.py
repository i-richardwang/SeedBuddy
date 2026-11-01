"""Wire documents consumed by a training worker."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, cast

from vitroctl.annotations import AnnotationDocument, parse_annotation
from vitroctl.contracts.documents import (
    as_digest,
    as_integer,
    as_list,
    as_number,
    as_object,
    as_string,
    expect_fields,
    expect_schema_version,
)
from vitroctl.contracts.identifiers import CLASS_NAME, VERSION_ID, WORKER_ID
from vitroctl.contracts.validation import validate_wire_contract
from vitroctl.datasets.manifest import as_split
from vitroctl.training.recipe import TrainingRecipe, parse_training_recipe

SNAPSHOT_SCHEMA_VERSION = 1
TrainingPhase = Literal["preparing", "training", "validating"]


@dataclass(frozen=True, slots=True, kw_only=True)
class TrainingCheckpoint:
    attempt: int
    epoch: int
    worker_id: str

    @classmethod
    def parse(cls, value: Any, context: str) -> TrainingCheckpoint:
        checkpoint = as_object(value, context)
        expect_fields(checkpoint, {"attempt", "epoch", "workerId"}, context)
        return cls(
            attempt=as_integer(checkpoint["attempt"], f"{context}.attempt", minimum=1),
            epoch=as_integer(checkpoint["epoch"], f"{context}.epoch", minimum=1),
            worker_id=_worker_id(checkpoint["workerId"], f"{context}.workerId"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class TrainingJob:
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
    def parse(cls, value: Any, context: str = "training run") -> TrainingJob:
        validate_wire_contract("training-run", value, context)
        run = as_object(value, context)
        expect_fields(
            run,
            {
                "schemaVersion",
                "id",
                "modelId",
                "datasetSnapshotId",
                "createdAt",
                "attempt",
                "targetWorkerId",
                "lastProgressAt",
                "checkpoint",
                "recipe",
                "state",
            },
            context,
        )
        expect_schema_version(run, "schemaVersion", 1, context)
        state_context = f"{context}.state"
        state = as_object(run["state"], state_context)
        expect_fields(
            state,
            {
                "status",
                "workerId",
                "sessionId",
                "leaseExpiresAt",
                "phase",
                "progress",
            },
            state_context,
        )
        if state["status"] != "running":
            raise ValueError(f"{state_context}.status must be running")
        phase = as_string(state["phase"], f"{state_context}.phase")
        if phase not in {"preparing", "training", "validating"}:
            raise ValueError(f"{state_context}.phase is invalid")
        progress = as_number(state["progress"], f"{state_context}.progress")
        if not 0 <= progress <= 1:
            raise ValueError(f"{state_context}.progress must be between 0 and 1")
        return cls(
            run_id=_resource_id(run["id"], f"{context}.id"),
            model_id=_resource_id(run["modelId"], f"{context}.modelId"),
            dataset_snapshot_id=_resource_id(
                run["datasetSnapshotId"], f"{context}.datasetSnapshotId"
            ),
            created_at=_timestamp(run["createdAt"], f"{context}.createdAt"),
            attempt=as_integer(run["attempt"], f"{context}.attempt", minimum=1),
            recipe=parse_training_recipe(run["recipe"], f"{context}.recipe"),
            worker_id=_worker_id(state["workerId"], f"{state_context}.workerId"),
            session_id=_resource_id(state["sessionId"], f"{state_context}.sessionId"),
            lease_expires_at=_timestamp(
                state["leaseExpiresAt"], f"{state_context}.leaseExpiresAt"
            ),
            phase=cast(TrainingPhase, phase),
            progress=progress,
            checkpoint=TrainingCheckpoint.parse(
                run["checkpoint"], f"{context}.checkpoint"
            )
            if run["checkpoint"] is not None
            else None,
        )


def _resource_id(value: Any, context: str) -> str:
    identifier = as_string(value, context)
    if not VERSION_ID.fullmatch(identifier):
        raise ValueError(f"{context} is invalid")
    return identifier


def _worker_id(value: Any, context: str) -> str:
    identifier = as_string(value, context)
    if not WORKER_ID.fullmatch(identifier):
        raise ValueError(f"{context} is invalid")
    return identifier


def _timestamp(value: Any, context: str) -> datetime:
    text = as_string(value, context)
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
    entry = as_object(value, context)
    expect_fields(entry, {"digest", "width", "height", "split", "annotation"}, context)
    digest = as_digest(entry["digest"], f"{context}.digest")
    annotation = parse_annotation(entry["annotation"], f"{context}.annotation")
    if annotation.digest != digest:
        raise ValueError(f"{context}.annotation describes another image")
    width = as_integer(entry["width"], f"{context}.width", minimum=1)
    height = as_integer(entry["height"], f"{context}.height", minimum=1)
    if (annotation.width, annotation.height) != (width, height):
        raise ValueError(
            f"{context}.annotation is drawn on {annotation.width}x{annotation.height}, "
            f"not {width}x{height}"
        )
    return SnapshotImage(
        digest=digest,
        width=width,
        height=height,
        split=as_split(entry["split"], f"{context}.split"),
        annotation=annotation,
    )


def parse_training_snapshot(value: Any, context: str = "snapshot") -> TrainingSnapshot:
    validate_wire_contract("training-snapshot", value, context)
    document = as_object(value, context)
    expect_fields(
        document,
        {
            "schemaVersion",
            "id",
            "datasetId",
            "modelId",
            "classes",
            "createdAt",
            "images",
        },
        context,
    )
    expect_schema_version(document, "schemaVersion", SNAPSHOT_SCHEMA_VERSION, context)
    images = tuple(
        _snapshot_image(raw, f"{context}.images[{index}]")
        for index, raw in enumerate(as_list(document["images"], f"{context}.images"))
    )
    digests = [image.digest for image in images]
    if len(set(digests)) != len(digests):
        raise ValueError(f"{context} lists an image digest more than once")
    classes = tuple(
        as_string(item, f"{context}.classes[{index}]")
        for index, item in enumerate(as_list(document["classes"], f"{context}.classes"))
    )
    if not classes or len(set(classes)) != len(classes):
        raise ValueError(f"{context}.classes must be non-empty and unique")
    for name in classes:
        if not CLASS_NAME.fullmatch(name):
            raise ValueError(f"{context}.classes contains invalid class {name}")
    known = set(classes)
    for image in images:
        for instance in image.annotation.instances:
            if instance.class_name not in known:
                raise ValueError(
                    f"{context} annotation uses unknown class {instance.class_name}"
                )
    return TrainingSnapshot(
        id=as_string(document["id"], f"{context}.id"),
        dataset_id=as_string(document["datasetId"], f"{context}.datasetId"),
        model_id=as_string(document["modelId"], f"{context}.modelId"),
        classes=classes,
        images=images,
    )
