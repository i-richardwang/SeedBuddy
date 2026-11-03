"""Wire documents consumed by a training worker."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from vitroctl.contracts.annotation import AnnotationDocument
from vitroctl.contracts.annotation_set import ImageDocuments, validate_annotation_set
from vitroctl.contracts.validation import validate_wire_contract
from vitroctl.training.recipe import TrainingRecipe

TrainingPhase = Literal["preparing", "training", "validating"]


@dataclass(frozen=True, slots=True, kw_only=True)
class TrainingCheckpoint:
    attempt: int
    epoch: int
    worker_id: str

    @classmethod
    def decode(cls, checkpoint: dict[str, Any]) -> TrainingCheckpoint:
        return cls(
            attempt=checkpoint["attempt"],
            epoch=checkpoint["epoch"],
            worker_id=checkpoint["workerId"],
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class TrainingClaim:
    run_id: str
    dataset_snapshot_id: str
    attempt: int
    recipe: TrainingRecipe
    worker_id: str
    session_id: str
    checkpoint: TrainingCheckpoint | None

    @classmethod
    def from_document(cls, value: Any, context: str = "training run") -> TrainingClaim:
        validate_wire_contract("training-run", value, context)
        return cls.decode(value)

    @classmethod
    def decode(cls, value: Any) -> TrainingClaim:
        context = "training run"
        state_context = f"{context}.state"
        state = value["state"]
        if state["status"] != "running":
            raise ValueError(f"{state_context}.status must be running")
        return cls(
            run_id=value["id"],
            dataset_snapshot_id=value["datasetSnapshotId"],
            attempt=value["attempt"],
            recipe=TrainingRecipe.decode(value["recipe"]),
            worker_id=state["workerId"],
            session_id=state["sessionId"],
            checkpoint=TrainingCheckpoint.decode(value["checkpoint"])
            if value["checkpoint"] is not None
            else None,
        )


@dataclass(frozen=True)
class SnapshotImage:
    digest: str
    width: int
    height: int
    split: str
    annotation: AnnotationDocument


@dataclass(frozen=True)
class TrainingSnapshot:
    classes: tuple[str, ...]
    images: tuple[SnapshotImage, ...]

    @classmethod
    def from_document(cls, value: Any, context: str = "snapshot") -> TrainingSnapshot:
        validate_wire_contract("training-snapshot", value, context)
        return cls.decode(value)

    @classmethod
    def decode(cls, value: Any) -> TrainingSnapshot:
        context = "snapshot"
        images = tuple(_snapshot_image(raw) for raw in value["images"])
        classes = tuple(value["classes"])
        validate_annotation_set(
            (
                ImageDocuments(
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
            classes=classes,
            images=images,
        )


def _snapshot_image(value: Any) -> SnapshotImage:
    digest = value["digest"]
    annotation = AnnotationDocument.decode(value["annotation"])
    return SnapshotImage(
        digest=digest,
        width=value["width"],
        height=value["height"],
        split=value["split"],
        annotation=annotation,
    )
