"""Wire documents consumed by a training worker."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from seedctl.contracts.annotation import AnnotationDocument
from seedctl.contracts.annotation_set import ImageDocuments, validate_annotation_set
from seedctl.contracts.coverage import (
    ImageCoverage,
    ModelArea,
    decode_coverage,
    validate_framing,
)
from seedctl.contracts.inference import InferenceMode, inference_mode_for_area
from seedctl.contracts.validation import validate_wire_contract
from seedctl.training.recipe import TrainingRecipe

TrainingPhase = Literal["preparing", "training", "validating"]


@dataclass(frozen=True)
class TrainingCheckpoint:
    attempt: int
    epoch: int
    worker_id: str

    @classmethod
    def decode(cls, checkpoint: dict[str, Any], context: str) -> TrainingCheckpoint:
        return cls(
            attempt=checkpoint["attempt"],
            epoch=checkpoint["epoch"],
            worker_id=checkpoint["workerId"],
        )


@dataclass(frozen=True)
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
        return cls.decode(value, context)

    @classmethod
    def decode(cls, value: Any, context: str) -> TrainingClaim:
        state = value["state"]
        if state["status"] != "running":
            raise ValueError(f"{context}.state.status must be running")
        return cls(
            run_id=value["id"],
            dataset_snapshot_id=value["datasetSnapshotId"],
            attempt=value["attempt"],
            recipe=TrainingRecipe.decode(value["recipe"], f"{context}.recipe"),
            worker_id=state["workerId"],
            session_id=state["sessionId"],
            checkpoint=TrainingCheckpoint.decode(
                value["checkpoint"], f"{context}.checkpoint"
            )
            if value["checkpoint"] is not None
            else None,
        )


@dataclass(frozen=True)
class SnapshotImage:
    digest: str
    width: int
    height: int
    split: str
    #: The dish the image is framed to, as the workbench froze it; None is whole.
    coverage: ImageCoverage | None
    annotation: AnnotationDocument


@dataclass(frozen=True)
class TrainingSnapshot:
    classes: tuple[str, ...]
    #: The model's area when the snapshot froze; the mode its version reads in.
    area: ModelArea
    images: tuple[SnapshotImage, ...]

    @property
    def mode(self) -> InferenceMode:
        return inference_mode_for_area(self.area)

    @classmethod
    def from_document(cls, value: Any, context: str = "snapshot") -> TrainingSnapshot:
        validate_wire_contract("training-snapshot", value, context)
        return cls.decode(value, context)

    @classmethod
    def decode(cls, value: Any, context: str) -> TrainingSnapshot:
        images = tuple(
            _snapshot_image(raw, f"{context}.images[{i}]")
            for i, raw in enumerate(value["images"])
        )
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
        area: ModelArea = value["area"]
        validate_framing(area, (image.coverage for image in images), context)
        return cls(
            classes=classes,
            area=area,
            images=images,
        )


def _snapshot_image(value: Any, context: str) -> SnapshotImage:
    return SnapshotImage(
        digest=value["digest"],
        width=value["width"],
        height=value["height"],
        split=value["split"],
        coverage=decode_coverage(value["coverage"], f"{context}.coverage"),
        annotation=AnnotationDocument.decode(
            value["annotation"], f"{context}.annotation"
        ),
    )
