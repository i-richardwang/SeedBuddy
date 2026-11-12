"""One portable model bundle: a manifest and immutable weights, never a checkpoint."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Protocol

from seedctl.contracts.inference import YOLO_IOU, InferenceMode
from seedctl.contracts.validation import validate_wire_contract
from seedctl.io.files import atomic_directory, file_digest

BUNDLE_SCHEMA_VERSION = 1


class TrainingPublication(Protocol):
    @property
    def best_weights(self) -> Path: ...

    @property
    def summary(self) -> Path: ...

    @property
    def context(self) -> dict[str, Any]: ...


def weights_descriptor(weights: Path) -> dict[str, Any]:
    return {"digest": file_digest(weights), "bytes": weights.stat().st_size}


def validate_bundle(document: Any, weights: Path) -> dict[str, Any]:
    validate_wire_contract("model-bundle", document, "model bundle")
    if weights_descriptor(weights) != document["weights"]:
        raise ValueError("Model weights differ from bundle digest or size")
    return document


def read_bundle(directory: Path) -> tuple[dict[str, Any], Path]:
    weights = directory / "weights.pt"
    document = json.loads((directory / "bundle.json").read_text())
    return validate_bundle(document, weights), weights


def write_bundle(
    weights: Path,
    document: dict[str, Any],
    output: Path,
) -> Path:
    """Write an already validated bundle atomically."""
    with atomic_directory(output) as temporary:
        shutil.copyfile(weights, temporary / "weights.pt")
        (temporary / "bundle.json").write_text(json.dumps(document, indent=2) + "\n")
    return output


def training_bundle(
    result: TrainingPublication,
    classes: list[str],
    provenance: dict[str, Any],
    *,
    mode: InferenceMode,
) -> dict[str, Any]:
    """Derive both schema-required metric fields from the publication's
    validation, and record the frame the dataset was exported in, which the
    version reads in from now on."""
    publication = json.loads(result.summary.read_text())
    inference = dict(publication["inference"])
    if inference.pop("ready") is not True:
        raise ValueError("Training produced no usable validation signal")
    document = {
        "schemaVersion": BUNDLE_SCHEMA_VERSION,
        "classes": classes,
        "weights": weights_descriptor(result.best_weights),
        "inference": {**inference, "mode": mode, "iou": YOLO_IOU},
        "training": publication["training"],
        "validation": publication["validation"],
        "provenance": {
            **provenance,
            **result.context,
            "evaluation": {
                **provenance["evaluation"],
                "metrics": publication["validation"],
            },
        },
    }
    return validate_bundle(document, result.best_weights)


def training_provenance(
    *,
    fingerprint: str | None,
    snapshot_id: str | None,
    dataset_description: str,
    evaluation_description: str,
) -> dict[str, Any]:
    return {
        "dataset": {
            "fingerprint": fingerprint,
            "snapshotId": snapshot_id,
            "description": dataset_description,
        },
        "selectedEpoch": None,
        "evaluation": {
            "description": evaluation_description,
            "calibration": "Best F1 confidence on validation split",
        },
    }
