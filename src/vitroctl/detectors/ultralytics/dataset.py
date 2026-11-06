from __future__ import annotations

import hashlib
import json
import os
import shutil
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

import cv2

from vitroctl.contracts.annotation import AnnotationInstance
from vitroctl.contracts.coverage import ImageCoverage
from vitroctl.contracts.inference import INFERENCE_MODES, InferenceMode
from vitroctl.datasets.geometry import require_image_dimensions
from vitroctl.datasets.manifest import AnnotatedImage, verified_blob
from vitroctl.image_geometry.window import PixelWindow, coverage_window
from vitroctl.io.files import atomic_directory
from vitroctl.io.image_io import CANONICAL_EXTENSION, read_image

DEFAULT_VALIDATION_FRACTION = 0.2
DEFAULT_SEED = 0
#: A framed image is written losslessly; only whole images keep their bytes.
FRAMED_EXTENSION = ".png"


class DatasetSplitError(ValueError):
    """An export cannot form training and validation splits."""


class YoloManifestImage(TypedDict):
    digest: str
    split: str
    image: str
    label: str
    instances: int
    #: The image pixels the exported file holds; None for the whole image.
    window: dict[str, int] | None


class YoloDatasetManifest(TypedDict):
    class_names: list[str]
    mode: InferenceMode
    seed: int
    validation_fraction: float
    images: list[YoloManifestImage]


@dataclass(frozen=True)
class DatasetImage:
    """Image and classified boxes in the canonical pixel-coordinate domain.

    ``split`` carries the stable assignment the server recorded for the image;
    images without one are assigned locally from the seed and validation fraction.
    ``coverage`` is the dish the workbench framed the image to; the export
    crops pixels and boxes alike to it, and None exports the whole image.
    """

    digest: str
    width: int
    height: int
    instances: tuple[AnnotationInstance, ...]
    file_path: Path
    split: str | None
    coverage: ImageCoverage | None


def _label_rows(
    image: DatasetImage, window: PixelWindow, class_indices: dict[str, int]
) -> list[str]:
    """One YOLO row per box within the exported window, normalised to it;
    boxes are clipped to the window and dropped when wholly outside."""
    rows = []
    for instance in image.instances:
        box = window.crop(instance.bbox)
        if box is None:
            continue
        center_x, center_y = box.center
        rows.append(
            f"{class_indices[instance.class_name]} "
            f"{center_x / window.width:.8f} "
            f"{center_y / window.height:.8f} "
            f"{box.width / window.width:.8f} "
            f"{box.height / window.height:.8f}"
        )
    return rows


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
    mode: InferenceMode,
    validation_fraction: float = DEFAULT_VALIDATION_FRACTION,
    seed: int = DEFAULT_SEED,
    link_images: bool = False,
) -> YoloDatasetManifest:
    """
    Publish schema-sourced classes and resolved image files as a YOLO dataset.

    In ``dish`` mode an image with coverage is framed to the square around
    its dish, written losslessly with its labels clipped to the frame; an
    image without coverage, and every image in ``whole_image`` mode, is the
    file itself. A caller that owns immutable sources may link whole images
    instead of copying; the dataset still outlives the sources, because a
    hard link is the file itself.
    """
    classes = tuple(class_names)
    class_indices = {name: index for index, name in enumerate(classes)}
    if not 0.0 < validation_fraction < 1.0:
        raise ValueError("Validation fraction must be between zero and one")
    if mode not in INFERENCE_MODES:
        raise ValueError(f"Unknown inference mode: {mode!r}")
    if mode == "whole_image" and any(image.coverage for image in images):
        raise ValueError("A whole_image export frames no image to a dish")

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
            window = (
                coverage_window(image.coverage, image.width, image.height)
                if image.coverage is not None
                else None
            )

            extension = CANONICAL_EXTENSION if window is None else FRAMED_EXTENSION
            image_destination = (
                working / "images" / split / f"{image.digest}{extension}"
            )
            label_destination = working / "labels" / split / f"{image.digest}.txt"
            image_destination.parent.mkdir(parents=True, exist_ok=True)
            label_destination.parent.mkdir(parents=True, exist_ok=True)
            if window is not None:
                framed = pixels[window.y : window.bottom, window.x : window.right]
                if not cv2.imwrite(str(image_destination), framed):
                    raise OSError(f"Unable to write framed image: {image.digest}")
            elif link_images:
                _link_or_copy(source, image_destination)
            else:
                shutil.copy2(source, image_destination)
            rows = _label_rows(
                image,
                window or PixelWindow.whole(image.width, image.height),
                class_indices,
            )
            label_destination.write_text(
                "".join(f"{row}\n" for row in rows), encoding="utf-8"
            )

            entry = YoloManifestImage(
                digest=image.digest,
                split=split,
                image=image_destination.relative_to(working).as_posix(),
                label=label_destination.relative_to(working).as_posix(),
                instances=len(rows),
                window=None if window is None else window.to_dict(),
            )
            manifest_images.append(entry)

        manifest = YoloDatasetManifest(
            class_names=list(classes),
            mode=mode,
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
    *,
    mode: InferenceMode,
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
            coverage=image.coverage,
        )
        for image in annotated
    ]
    return export_dataset_images(
        images,
        class_names,
        output_dir,
        validation_fraction=validation_fraction,
        seed=seed,
        mode=mode,
    )
