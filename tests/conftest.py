from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest

from vitroctl.datasets.manifest import (
    MANIFEST_SCHEMA_VERSION,
    blob_path,
    manifest_path,
)
from vitroctl.models.bundle import weights_descriptor

SEED_CLASSES = ("ungerminated", "germinated")


def annotation_document(
    digest: str,
    boxes: list[dict[str, float]] | None = None,
    *,
    width: int = 100,
    height: int = 80,
) -> dict[str, Any]:
    if boxes is None:
        boxes = [{"x": 10, "y": 20, "width": 8, "height": 6}]
    return {
        "schemaVersion": 1,
        "image": {"digest": digest, "width": width, "height": height},
        "instances": [
            {"id": f"seed-{index + 1}", "class": "ungerminated", "bbox": box}
            for index, box in enumerate(boxes)
        ],
    }


def detection_document(
    digest: str, *, width: int = 1000, height: int = 800
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "image": {"digest": digest, "width": width, "height": height},
        "producer": {
            "modelVersionId": "set.traditional-v1",
            "artifactDigest": "a" * 64,
            "runtime": {"adapter": "traditional", "fingerprint": "b" * 64},
        },
        "instances": [
            {
                "id": "1",
                "class": "ungerminated",
                "bbox": {"x": 96.25, "y": 196.25, "width": 7.5, "height": 7.5},
                "score": 0.9,
            }
        ],
        "quality": {"status": "ok", "warnings": []},
    }


def manifest_entry(
    digest: str,
    *,
    width: int = 100,
    height: int = 80,
    size: int = 1,
    split: str | None = None,
    detection: dict[str, Any] | None = None,
    annotation: dict[str, Any] | None = None,
    unclear: bool = False,
) -> dict[str, Any]:
    return {
        "digest": digest,
        "width": width,
        "height": height,
        "filename": f"{digest[:4]}.jpg",
        "bytes": size,
        "split": split,
        "detection": detection,
        "annotation": annotation,
        "unclear": unclear,
    }


def manifest_document(
    dataset: str,
    images: list[dict[str, Any]],
    *,
    model_id: str = "seed-detector",
    classes: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "dataset": dataset,
        "model": {
            "id": model_id,
            "classes": classes if classes is not None else list(SEED_CLASSES),
        },
        "images": images,
    }


def write_manifest(
    data_root: Path,
    dataset: str,
    images: list[dict[str, Any]],
    *,
    model_id: str = "seed-detector",
    classes: list[str] | None = None,
) -> Path:
    path = manifest_path(data_root, dataset)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            manifest_document(
                dataset,
                images,
                model_id=model_id,
                classes=classes,
            )
        ),
        encoding="utf-8",
    )
    return path


def encoded_image(width: int = 100, height: int = 80, variant: int = 0) -> bytes:
    """Canonical-format bytes; ``variant`` makes distinct valid images."""
    pixels = np.zeros((height, width, 3), np.uint8)
    pixels[:] = (
        (variant * 37) % 256,
        (variant * 67) % 256,
        (variant * 97) % 256,
    )
    encoded, buffer = cv2.imencode(".avif", pixels, [cv2.IMWRITE_AVIF_QUALITY, 90])
    assert encoded
    return buffer.tobytes()


def write_blob(data_root: Path, data: bytes) -> str:
    digest = hashlib.sha256(data).hexdigest()
    target = blob_path(data_root, digest)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return digest


PARAMETERS = {
    "epochs": 3,
    "patience": 20,
    "batch": 4,
    "imgsz": 768,
    "optimizer": "AdamW",
    "lr0": 0.001,
    "warmup_epochs": 3.0,
    "mosaic": 0.0,
    "mixup": 0.0,
    "copy_paste": 0.0,
    "max_det": 500,
    "seed": 0,
    "deterministic": True,
}


@pytest.fixture
def recipe(request: pytest.FixtureRequest) -> dict[str, Any]:
    filename = getattr(request, "param", "yolo26n-whole-v1.recipe.json")
    path = Path(__file__).parents[1] / "configs/yolo26" / filename
    return json.loads(path.read_text())


def model_bundle(weights: Path, recipe):
    return {
        "schemaVersion": 1,
        "classes": ["seed"],
        "weights": weights_descriptor(weights),
        "inference": {
            "mode": "whole_image",
            "iou": 0.7,
            "confidence": 0.26,
            "imageSize": 1536,
            "maxDetections": 500,
            "endToEnd": False,
        },
        "training": recipe,
        "validation": {
            "precision": 0.5,
            "recall": 0.4,
            "map50": 0.5,
            "map50To95": 0.3,
            "fitness": 0.3,
        },
        "provenance": {
            "dataset": {
                "fingerprint": None,
                "snapshotId": None,
                "description": "Independent experiment",
            },
            "selectedEpoch": 30,
            "codeRevision": None,
            "effectiveParameters": {"nbs": 8},
            "evaluation": {
                "description": "15 comparison images",
                "calibration": "8 calibration images",
                "metrics": {"countMae": 17.5},
            },
        },
    }


def decode_annotation(value, context="annotation"):
    from vitroctl.contracts.annotation import AnnotationDocument
    from vitroctl.contracts.validation import validate_wire_contract

    validate_wire_contract("annotation", value, context)
    return AnnotationDocument.decode(value, context)


def decode_detection(value, context="detection"):
    from vitroctl.contracts.validation import validate_wire_contract
    from vitroctl.detectors.contract import DetectionResult

    validate_wire_contract("detection-result", value, context)
    return DetectionResult.decode(value, context)


def decode_model_manifest(value, context="model manifest"):
    from vitroctl.contracts.validation import validate_wire_contract
    from vitroctl.worker.model_store import ModelManifest

    validate_wire_contract("inference-model-manifest", value, context)
    return ModelManifest.decode(value, context)
