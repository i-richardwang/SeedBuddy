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
from vitroctl.contracts.validation import validate_wire_contract
from vitroctl.detectors.contract import DetectionResult
from vitroctl.io.files import file_digest

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
    detection: DetectionResult | None
    annotation: AnnotationDocument | None
    # A person found the photograph unclear; a manifest that does not say is clear.
    unclear: bool = False

    def to_dict(self) -> dict[str, object]:
        return {
            "digest": self.digest,
            "width": self.width,
            "height": self.height,
            "filename": self.filename,
            "bytes": self.bytes,
            "split": self.split,
            "detection": None if self.detection is None else self.detection.to_dict(),
            "annotation": (
                None if self.annotation is None else self.annotation.to_dict()
            ),
            "unclear": self.unclear,
        }


@dataclass(frozen=True)
class DatasetManifest:
    dataset: str
    model_id: str
    classes: tuple[str, ...]
    images: tuple[ManifestImage, ...]

    @classmethod
    def from_document(cls, value: Any, context: str = "manifest") -> DatasetManifest:
        validate_wire_contract("dataset-manifest", value, context)
        document = value
        dataset = document["dataset"]
        model = document["model"]
        model_id = model["id"]
        classes = tuple(model["classes"])
        images = tuple(
            _image(raw, f"{context}.images[{index}]")
            for index, raw in enumerate(document["images"])
        )
        digests = [image.digest for image in images]
        if len(set(digests)) != len(digests):
            raise ValueError(f"{context} lists an image digest more than once")
        known_classes = set(classes)
        for index, image in enumerate(images):
            for field, payload in (
                ("detection", image.detection),
                ("annotation", image.annotation),
            ):
                if payload is None:
                    continue
                document_context = f"{context}.images[{index}].{field}"
                if payload.digest != image.digest:
                    raise ValueError(f"{document_context} describes another image")
                if payload.width != image.width or payload.height != image.height:
                    raise ValueError(
                        f"{document_context} dimensions differ from the image"
                    )
                unknown = sorted(
                    {instance.class_name for instance in payload.instances}
                    - known_classes
                )
                if unknown:
                    raise ValueError(
                        f"{document_context} uses unknown class"
                        f"{'es' if len(unknown) > 1 else ''}: {', '.join(unknown)}"
                    )
        return cls(dataset=dataset, model_id=model_id, classes=classes, images=images)

    def to_dict(self) -> dict[str, object]:
        return {
            "schemaVersion": MANIFEST_SCHEMA_VERSION,
            "dataset": self.dataset,
            "model": {"id": self.model_id, "classes": list(self.classes)},
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
        actual_digest = file_digest(path)
    except FileNotFoundError as error:
        raise BlobError(f"Blob is missing from the data root: {digest}") from error
    if actual_digest != digest:
        raise BlobError(f"Blob failed digest verification: {digest}")
    return path


def manifest_path(data_root: str | Path, dataset: str) -> Path:
    return Path(data_root) / "datasets" / f"{dataset}.json"


def _image(value: Any, context: str) -> ManifestImage:
    entry = value
    detection = None
    if entry["detection"] is not None:
        detection = DetectionResult.from_document(
            entry["detection"], f"{context}.detection"
        )
    annotation = (
        None
        if entry["annotation"] is None
        else AnnotationDocument.from_document(
            entry["annotation"], f"{context}.annotation"
        )
    )
    return ManifestImage(
        digest=entry["digest"],
        width=entry["width"],
        height=entry["height"],
        filename=entry["filename"],
        bytes=entry["bytes"],
        split=entry["split"],
        detection=detection,
        annotation=annotation,
        unclear=entry.get("unclear", False),
    )


def encode_dataset_manifest(manifest: DatasetManifest) -> bytes:
    """Encode the canonical manifest representation used in transit."""
    encoded = (
        json.dumps(manifest.to_dict(), ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")
    if len(encoded) > MAX_DATASET_MANIFEST_BYTES:
        raise ValueError(f"Manifest exceeds {MAX_DATASET_MANIFEST_BYTES} bytes")
    return encoded


def load_dataset_manifest(path: str | Path) -> DatasetManifest:
    source = Path(path)
    return DatasetManifest.from_document(
        json.loads(source.read_text(encoding="utf-8")), str(source)
    )
