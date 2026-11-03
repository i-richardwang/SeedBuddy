"""One portable model bundle: a manifest and immutable weights, never a checkpoint."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

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


def write_bundle(weights: Path, document: dict[str, Any], output: Path) -> Path:
    validate_bundle(document, weights)
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
    return validate_bundle(
        {
            "schemaVersion": 1,
            "classes": classes,
            "weights": weights_descriptor(weights),
            "inference": {**inference, "mode": "whole_image", "iou": 0.7},
            "training": publication["training"],
            "validation": publication["validation"],
            "provenance": provenance,
        },
        weights,
    )
