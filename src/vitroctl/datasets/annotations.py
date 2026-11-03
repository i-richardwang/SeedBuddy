"""Reviewed images materialized from a dataset manifest."""

from pathlib import Path

from vitroctl.datasets.manifest import ManifestImage, load_dataset_manifest


def load_annotations(manifest: str | Path) -> list[ManifestImage]:
    """Every annotated image of a dataset manifest, in manifest order."""
    dataset = load_dataset_manifest(manifest)
    return [entry for entry in dataset.images if entry.annotation is not None]
