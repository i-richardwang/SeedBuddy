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
from vitroctl.contracts.identifiers import CLASS_NAME
from vitroctl.datasets.annotations import AnnotatedImage
from vitroctl.datasets.manifest import verified_blob
from vitroctl.io.files import atomic_directory
from vitroctl.io.image_io import CANONICAL_EXTENSION, read_image


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
    split: str | None = None
    file_path: Path | None = None


def _label_text(image: DatasetImage, class_indices: dict[str, int]) -> str:
    rows = []
    for instance in image.instances:
        try:
            class_index = class_indices[instance.class_name]
        except KeyError as error:
            raise ValueError(
                f"Image {image.digest} uses unknown class {instance.class_name}"
            ) from error
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


def _image_file(image: DatasetImage, data_root: Path) -> Path:
    """The verified data-root blob, or the already verified file the caller supplied."""
    if image.file_path is None:
        return verified_blob(data_root, image.digest)
    if not image.file_path.is_file():
        raise FileNotFoundError(image.file_path)
    return image.file_path.resolve()


def _link_or_copy(source: Path, destination: Path) -> None:
    try:
        os.link(source, destination)
    except OSError:  # another volume, or a file system without hard links
        shutil.copy2(source, destination)


def assign_splits(
    images: Sequence[DatasetImage], validation_fraction: float, seed: int
) -> dict[str, str]:
    """Split per digest: recorded splits as they are, the rest seeded by digest.

    Locally assigned images fill the validation quota the fraction implies for
    the whole set, and the result always contains both a train and a val image.
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
    if set(splits.values()) != {"train", "val"}:
        raise ValueError("YOLO dataset requires both train and val images")
    return splits


def export_dataset_images(
    images: Sequence[DatasetImage],
    class_names: Sequence[str],
    data_root: str | Path,
    output_dir: str | Path,
    *,
    validation_fraction: float = 0.2,
    seed: int = 0,
    link_images: bool = False,
) -> YoloDatasetManifest:
    """
    Publish a self-contained YOLO detection dataset atomically. A caller that
    owns immutable sources may link them instead of copying; the dataset
    still outlives the sources, because a hard link is the file itself.
    """
    if len(images) < 2:
        raise ValueError("YOLO export requires at least two images")
    digests = [image.digest for image in images]
    if len(set(digests)) != len(digests):
        raise ValueError("YOLO export requires unique image digests")
    classes = tuple(class_names)
    if not classes or len(set(classes)) != len(classes):
        raise ValueError("YOLO export class names must be non-empty and unique")
    for name in classes:
        if not CLASS_NAME.fullmatch(name):
            raise ValueError(f"Invalid YOLO class name: {name}")
    class_indices = {name: index for index, name in enumerate(classes)}
    if not 0.0 < validation_fraction < 1.0:
        raise ValueError("Validation fraction must be between zero and one")

    root = Path(data_root).resolve()
    splits = assign_splits(images, validation_fraction, seed)
    manifest_images: list[YoloManifestImage] = []

    with atomic_directory(output_dir) as working:
        for image in sorted(images, key=lambda item: item.digest):
            split = splits[image.digest]
            source = _image_file(image, root)
            pixels = read_image(source)
            height, width = pixels.shape[:2]
            if (width, height) != (image.width, image.height):
                raise ValueError(
                    f"Image dimensions differ from annotation for {image.digest}: "
                    f"{width}x{height} != {image.width}x{image.height}"
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
    validation_fraction: float = 0.2,
    seed: int = 0,
) -> YoloDatasetManifest:
    """Export the annotations as a YOLO detection dataset."""
    images = [
        DatasetImage(
            digest=image.entry.digest,
            width=image.annotation.width,
            height=image.annotation.height,
            instances=image.annotation.instances,
            split=image.entry.split,
        )
        for image in annotated
    ]
    return export_dataset_images(
        images,
        class_names,
        data_root,
        output_dir,
        validation_fraction=validation_fraction,
        seed=seed,
    )
