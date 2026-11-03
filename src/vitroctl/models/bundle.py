"""One portable model bundle: a manifest and immutable weights, never a checkpoint."""

from __future__ import annotations

import json
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

from vitroctl.contracts.inference import YOLO_IOU
from vitroctl.contracts.validation import validate_wire_contract
from vitroctl.io.files import atomic_directory, file_digest


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
    *,
    verify_runtime: Callable[[dict[str, Any], Path], None] | None = None,
) -> Path:
    validate_bundle(document, weights)
    if verify_runtime is not None:
        verify_runtime(document, weights)
    with atomic_directory(output) as temporary:
        shutil.copyfile(weights, temporary / "weights.pt")
        (temporary / "bundle.json").write_text(json.dumps(document, indent=2) + "\n")
    return output


def training_bundle(
    weights: Path, summary: Path, classes: list[str], provenance: dict[str, Any]
) -> dict[str, Any]:
    publication = json.loads(summary.read_text())
    context = summary.parent / "training-context.json"
    provenance = {**provenance, **json.loads(context.read_text())}
    inference = dict(publication["inference"])
    if inference.pop("ready") is not True:
        raise ValueError("Training produced no usable validation signal")
    return {
        "schemaVersion": 1,
        "classes": classes,
        "weights": weights_descriptor(weights),
        "inference": {**inference, "mode": "whole_image", "iou": YOLO_IOU},
        "training": publication["training"],
        "validation": publication["validation"],
        "provenance": provenance,
    }


def training_provenance(
    *,
    fingerprint: str | None,
    snapshot_id: str | None,
    dataset_description: str,
    evaluation_description: str,
    metrics: dict[str, float],
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
            "metrics": metrics,
        },
    }
