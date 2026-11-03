from __future__ import annotations

import hashlib
import json
import os
import shutil
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

from vitroctl.contracts.annotation import AnnotationInstance
from vitroctl.datasets.geometry import require_image_dimensions
from vitroctl.datasets.manifest import AnnotatedImage, verified_blob
from vitroctl.io.files import atomic_directory
from vitroctl.io.image_io import CANONICAL_EXTENSION, read_image

DEFAULT_VALIDATION_FRACTION = 0.2
DEFAULT_SEED = 0


class DatasetSplitError(ValueError):
    """An export cannot form training and validation splits."""


class YoloManifestImage(TypedDict):
    digest: str
    split: str
    image: str
    label: str
    instances: int


class YoloDatasetManifest(TypedDict):
    class_names: list[str]
    seed: int
    validation_fraction: float
    images: list[YoloManifestImage]


@dataclass(frozen=True)
class DatasetImage:
    """Image and classified boxes in the canonical pixel-coordinate domain.

    ``split`` carries the stable assignment the server recorded for the image;
    images without one are assigned locally from the seed and validation fraction.
    """

    digest: str
    width: int
    height: int
    instances: tuple[AnnotationInstance, ...]
    file_path: Path
    split: str | None


def _label_text(image: DatasetImage, class_indices: dict[str, int]) -> str:
    rows = []
    for instance in image.instances:
        class_index = class_indices[instance.class_name]
        box = instance.bbox
        center_x, center_y = box.center
        rows.append(
            f"{class_index} "
            f"{center_x / image.width:.8f} "
            f"{center_y / image.height:.8f} "
            f"{box.width / image.width:.8f} "
            f"{box.height / image.height:.8f}"
        )
    return "\n".join(rows) + ("\n" if rows else "")


def _link_or_copy(source: Path, destination: Path) -> None:
    try:
        os.link(source, destination)
    except OSError:  # another volume, or a file system without hard links
        shutil.copy2(source, destination)


def assign_splits(
    images: Sequence[DatasetImage], validation_fraction: float, seed: int
) -> dict[str, str]:
    """Split per digest: recorded splits as they are, the rest seeded by digest.

    Locally assigned images fill the validation quota for the whole set.
    """
    splits = {image.digest: image.split for image in images if image.split}
    unassigned = sorted(
        (image for image in images if image.split is None),
        key=lambda image: hashlib.sha256(f"{seed}:{image.digest}".encode()).hexdigest(),
    )
    if unassigned:
        recorded_val = sum(split == "val" for split in splits.values())
        recorded_train = len(splits) - recorded_val
        quota = round(len(images) * validation_fraction) - recorded_val
        quota = max(quota, 1 - recorded_val)
        quota = min(quota, len(unassigned) - (1 - min(recorded_train, 1)))
        for index, image in enumerate(unassigned):
            splits[image.digest] = "val" if index < quota else "train"
    return splits


def export_dataset_images(
    images: Sequence[DatasetImage],
    class_names: Sequence[str],
    output_dir: str | Path,
    *,
    validation_fraction: float = DEFAULT_VALIDATION_FRACTION,
    seed: int = DEFAULT_SEED,
    link_images: bool = False,
) -> YoloDatasetManifest:
    """
    Publish schema-sourced classes and resolved image files as a YOLO dataset.

    A caller that
    owns immutable sources may link them instead of copying; the dataset
    still outlives the sources, because a hard link is the file itself.
    """
    classes = tuple(class_names)
    class_indices = {name: index for index, name in enumerate(classes)}
    if not 0.0 < validation_fraction < 1.0:
        raise ValueError("Validation fraction must be between zero and one")

    splits = assign_splits(images, validation_fraction, seed)
    if set(splits.values()) != {"train", "val"}:
        raise DatasetSplitError("YOLO dataset requires both train and val images")
    manifest_images: list[YoloManifestImage] = []

    with atomic_directory(output_dir) as working:
        for image in sorted(images, key=lambda item: item.digest):
            split = splits[image.digest]
            source = image.file_path
            pixels = read_image(source)
            require_image_dimensions(
                pixels.shape, image.width, image.height, image.digest
            )

            image_destination = (
                working / "images" / split / f"{image.digest}{CANONICAL_EXTENSION}"
            )
            label_destination = working / "labels" / split / f"{image.digest}.txt"
            image_destination.parent.mkdir(parents=True, exist_ok=True)
            label_destination.parent.mkdir(parents=True, exist_ok=True)
            if link_images:
                _link_or_copy(source, image_destination)
            else:
                shutil.copy2(source, image_destination)
            label_destination.write_text(
                _label_text(image, class_indices), encoding="utf-8"
            )

            entry = YoloManifestImage(
                digest=image.digest,
                split=split,
                image=image_destination.relative_to(working).as_posix(),
                label=label_destination.relative_to(working).as_posix(),
                instances=len(image.instances),
            )
            manifest_images.append(entry)

        manifest = YoloDatasetManifest(
            class_names=list(classes),
            seed=seed,
            validation_fraction=validation_fraction,
            images=manifest_images,
        )
        (working / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )
        names = "".join(f"  {index}: {name}\n" for index, name in enumerate(classes))
        (working / "dataset.yaml").write_text(
            f"train: images/train\nval: images/val\nnames:\n{names}", encoding="utf-8"
        )
    return manifest


def export_yolo_dataset(
    annotated: Sequence[AnnotatedImage],
    class_names: Sequence[str],
    data_root: str | Path,
    output_dir: str | Path,
    validation_fraction: float = DEFAULT_VALIDATION_FRACTION,
    seed: int = DEFAULT_SEED,
) -> YoloDatasetManifest:
    """Export the annotations as a YOLO detection dataset."""
    images = [
        DatasetImage(
            digest=image.digest,
            width=image.width,
            height=image.height,
            instances=image.annotation.instances,
            split=image.split,
            file_path=verified_blob(data_root, image.digest),
        )
        for image in annotated
    ]
    return export_dataset_images(
        images,
        class_names,
        output_dir,
        validation_fraction=validation_fraction,
        seed=seed,
    )
