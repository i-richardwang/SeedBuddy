"""The dataset manifest: one workbench dataset described by content-addressed images.

A data root holds every image as a blob named by the SHA-256 digest of its bytes
and one manifest per dataset listing those digests together with the detection and
annotation documents recorded for them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from vitroctl.contracts.annotation import AnnotationDocument
from vitroctl.contracts.annotation_set import ImageDocuments, validate_annotation_set
from vitroctl.contracts.coverage import (
    ImageCoverage,
    ModelArea,
    decode_coverage,
    validate_framing,
)
from vitroctl.contracts.validation import validate_wire_contract
from vitroctl.detectors.contract import DetectionResult
from vitroctl.io.files import file_digest, verify_digest

MANIFEST_SCHEMA_VERSION = 1
MAX_DATASET_MANIFEST_BYTES = 16 * 1024 * 1024


@dataclass(frozen=True)
class ManifestImage:
    digest: str
    width: int
    height: int
    filename: str
    bytes: int
    split: str | None
    #: The dish a ``dish`` model frames the image to; None for the whole image.
    coverage: ImageCoverage | None
    detection: DetectionResult | None
    annotation: AnnotationDocument | None
    unclear: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "digest": self.digest,
            "width": self.width,
            "height": self.height,
            "filename": self.filename,
            "bytes": self.bytes,
            "split": self.split,
            "coverage": None if self.coverage is None else self.coverage.to_dict(),
            "detection": None if self.detection is None else self.detection.to_dict(),
            "annotation": (
                None if self.annotation is None else self.annotation.to_dict()
            ),
            "unclear": self.unclear,
        }


@dataclass(frozen=True)
class AnnotatedImage(ManifestImage):
    annotation: AnnotationDocument


@dataclass(frozen=True)
class DatasetManifest:
    dataset: str
    model_id: str
    classes: tuple[str, ...]
    #: Where the model looks: ``dish`` frames each image to its coverage.
    area: ModelArea
    images: tuple[ManifestImage, ...]

    @classmethod
    def from_document(cls, value: Any, context: str = "manifest") -> DatasetManifest:
        validate_wire_contract("dataset-manifest", value, context)
        return cls.decode(value, context)

    @classmethod
    def decode(cls, value: Any, context: str) -> DatasetManifest:
        dataset = value["dataset"]
        model = value["model"]
        model_id = model["id"]
        classes = tuple(model["classes"])
        area: ModelArea = model["area"]
        images = tuple(
            _image(raw, f"{context}.images[{i}]")
            for i, raw in enumerate(value["images"])
        )
        validate_annotation_set(
            (
                ImageDocuments(
                    image.digest,
                    image.width,
                    image.height,
                    {"detection": image.detection, "annotation": image.annotation},
                )
                for image in images
            ),
            classes,
            context,
        )
        validate_framing(area, (image.coverage for image in images), context)
        return cls(
            dataset=dataset,
            model_id=model_id,
            classes=classes,
            area=area,
            images=images,
        )

    @property
    def annotated(self) -> tuple[AnnotatedImage, ...]:
        return tuple(
            AnnotatedImage(
                digest=image.digest,
                width=image.width,
                height=image.height,
                filename=image.filename,
                bytes=image.bytes,
                split=image.split,
                coverage=image.coverage,
                detection=image.detection,
                annotation=image.annotation,
                unclear=image.unclear,
            )
            for image in self.images
            if image.annotation is not None
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "schemaVersion": MANIFEST_SCHEMA_VERSION,
            "dataset": self.dataset,
            "model": {
                "id": self.model_id,
                "classes": list(self.classes),
                "area": self.area,
            },
            "images": [image.to_dict() for image in self.images],
        }


class BlobError(RuntimeError):
    """A blob the data root should hold is missing or does not match its digest."""


def blob_path(data_root: str | Path, digest: str) -> Path:
    """Where the data root stores the blob named ``digest``; readers use ``verified_blob``."""
    return Path(data_root) / "blobs" / digest[:2] / digest


def verified_blob(data_root: str | Path, digest: str) -> Path:
    """The path of the blob named ``digest`` once its bytes hash to that digest."""
    path = blob_path(data_root, digest)
    try:
        verify_digest(file_digest(path), digest)
    except FileNotFoundError as error:
        raise BlobError(f"Blob is missing from the data root: {digest}") from error
    except ValueError as error:
        raise BlobError(str(error)) from error
    return path


def manifest_path(data_root: str | Path, dataset: str) -> Path:
    return Path(data_root) / "datasets" / f"{dataset}.json"


def _image(value: Any, context: str) -> ManifestImage:
    detection = None
    if value["detection"] is not None:
        detection = DetectionResult.decode(value["detection"], f"{context}.detection")
    annotation = (
        None
        if value["annotation"] is None
        else AnnotationDocument.decode(value["annotation"], f"{context}.annotation")
    )
    return ManifestImage(
        digest=value["digest"],
        width=value["width"],
        height=value["height"],
        filename=value["filename"],
        bytes=value["bytes"],
        split=value["split"],
        coverage=decode_coverage(value["coverage"], f"{context}.coverage"),
        detection=detection,
        annotation=annotation,
        unclear=value["unclear"],
    )


def encode_dataset_manifest(document: dict[str, Any]) -> bytes:
    """Encode the canonical manifest representation used in transit."""
    encoded = (
        json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")
    if len(encoded) > MAX_DATASET_MANIFEST_BYTES:
        raise ValueError(f"Manifest exceeds {MAX_DATASET_MANIFEST_BYTES} bytes")
    return encoded


def load_dataset_manifest(path: str | Path) -> DatasetManifest:
    source = Path(path)
    return DatasetManifest.from_document(
        json.loads(source.read_text(encoding="utf-8")), str(source)
    )
