"""Reviewed images materialized from a dataset manifest."""

from dataclasses import dataclass
from pathlib import Path

from vitroctl.contracts.annotation import AnnotationDocument
from vitroctl.datasets.manifest import ManifestImage, load_dataset_manifest


@dataclass(frozen=True)
class AnnotatedImage:
    """A manifest entry together with the annotation recorded for it."""

    entry: ManifestImage
    annotation: AnnotationDocument


def load_annotations(manifest: str | Path) -> list[AnnotatedImage]:
    """Every annotated image of a dataset manifest, in manifest order."""

    dataset = load_dataset_manifest(manifest)
    annotated = []
    for entry in dataset.images:
        if entry.annotation is None:
            continue
        annotated.append(AnnotatedImage(entry, entry.annotation))
    return annotated
