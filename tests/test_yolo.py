from pathlib import Path

import pytest
from conftest import (
    SEED_CLASSES,
    annotation_document,
    decode_annotation,
    encoded_image,
    manifest_entry,
    write_blob,
    write_manifest,
)

from seedctl.contracts.annotation import (
    AnnotationInstance,
    BoundingBox,
)
from seedctl.contracts.coverage import ImageCoverage
from seedctl.datasets.manifest import (
    AnnotatedImage,
    BlobError,
    blob_path,
    load_dataset_manifest,
)
from seedctl.detectors.ultralytics import (
    DatasetImage,
    export_dataset_images,
    export_yolo_dataset,
)
from seedctl.detectors.ultralytics.dataset import assign_splits
from seedctl.io.image_io import CANONICAL_EXTENSION, read_image


def _annotated(digest: str, split: str | None = None) -> AnnotatedImage:
    return AnnotatedImage(
        digest=digest,
        width=100,
        height=80,
        filename=f"{digest[:4]}.jpg",
        bytes=1,
        split=split,
        coverage=None,
        detection=None,
        annotation=decode_annotation(
            annotation_document(digest, [{"x": 10, "y": 20, "width": 20, "height": 10}])
        ),
        unclear=False,
    )


def _annotated_blobs(
    data_root: Path, count: int, splits: tuple[str | None, ...] = ()
) -> list[AnnotatedImage]:
    """Annotated images whose blobs are written in variant order."""
    return [
        _annotated(
            write_blob(data_root, encoded_image(variant=variant)),
            splits[variant] if variant < len(splits) else None,
        )
        for variant in range(count)
    ]


def test_yolo_export_is_deterministic_and_self_contained(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    annotated = _annotated_blobs(data_root, 2)

    output = tmp_path / "yolo"
    manifest = export_yolo_dataset(
        annotated, SEED_CLASSES, data_root, output, mode="whole_image", seed=7
    )

    entries = manifest["images"]
    assert [entry["digest"] for entry in entries] == sorted(
        image.digest for image in annotated
    )
    assert {entry["split"] for entry in entries} == {"train", "val"}
    for entry in entries:
        assert (
            entry["image"]
            == f"images/{entry['split']}/{entry['digest']}{CANONICAL_EXTENSION}"
        )
        assert entry["label"] == f"labels/{entry['split']}/{entry['digest']}.txt"
        assert (output / entry["image"]).is_file()
    dataset_yaml = (output / "dataset.yaml").read_text()
    assert "path:" not in dataset_yaml
    assert "train: images/train" in dataset_yaml
    labels = list((output / "labels").rglob("*.txt"))
    assert len(labels) == 2
    assert labels[0].read_text().strip().split() == [
        "0",
        "0.20000000",
        "0.31250000",
        "0.20000000",
        "0.12500000",
    ]

    with pytest.raises(FileExistsError, match="already exists"):
        export_yolo_dataset(
            annotated, SEED_CLASSES, data_root, output, mode="whole_image", seed=7
        )


def test_yolo_export_preserves_the_model_class_order(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    images = []
    for variant, class_name in enumerate(("germinated", "seed")):
        digest = write_blob(data_root, encoded_image(variant=variant))
        images.append(
            DatasetImage(
                digest=digest,
                split=None,
                file_path=blob_path(data_root, digest),
                coverage=None,
                width=100,
                height=80,
                instances=(
                    AnnotationInstance(
                        instance_id=f"{class_name}-1",
                        class_name=class_name,
                        bbox=BoundingBox(10, 20, 20, 10),
                    ),
                ),
            )
        )

    output = tmp_path / "yolo"
    manifest = export_dataset_images(
        images,
        ("seed", "germinated"),
        output,
        mode="whole_image",
        seed=7,
    )

    assert manifest["class_names"] == ["seed", "germinated"]
    labels = {
        entry["digest"]: (output / entry["label"]).read_text().split()[0]
        for entry in manifest["images"]
    }
    assert labels[images[0].digest] == "1"
    assert labels[images[1].digest] == "0"
    assert (
        (output / "dataset.yaml")
        .read_text()
        .endswith("names:\n  0: seed\n  1: germinated\n")
    )


def test_yolo_validation_split_is_stable_per_digest(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    annotated = _annotated_blobs(data_root, 5)

    first = export_yolo_dataset(
        annotated, SEED_CLASSES, data_root, tmp_path / "one", mode="whole_image", seed=3
    )
    second = export_yolo_dataset(
        annotated[::-1],
        SEED_CLASSES,
        data_root,
        tmp_path / "two",
        mode="whole_image",
        seed=3,
    )

    assert first["images"] == second["images"]
    assert sum(entry["split"] == "val" for entry in first["images"]) == 1


def test_split_assignment_fills_the_quota_around_recorded_splits() -> None:
    def image(digest: str, split: str | None = None) -> DatasetImage:
        return DatasetImage(
            digest=digest,
            width=100,
            height=80,
            instances=(),
            split=split,
            file_path=Path(digest),
            coverage=None,
        )

    recorded = [image("1" * 64, "val"), image("2" * 64, "train")]
    unassigned = [image(f"{index:064x}") for index in range(3, 11)]

    splits = assign_splits(recorded + unassigned, 0.2, seed=1)

    assert splits["1" * 64] == "val" and splits["2" * 64] == "train"
    assert sum(split == "val" for split in splits.values()) == 2
    assert assign_splits(recorded + unassigned, 0.2, seed=1) == splits

    only_val = [image("1" * 64, "val"), image("2" * 64)]
    assert assign_splits(only_val, 0.9, seed=1)["2" * 64] == "train"
    only_train = [image("1" * 64, "train"), image("2" * 64)]
    assert assign_splits(only_train, 0.1, seed=1)["2" * 64] == "val"


def test_yolo_export_discards_an_invalid_dataset(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    annotated = [
        _annotated(write_blob(data_root, encoded_image())),
        _annotated(write_blob(data_root, encoded_image(height=60))),
    ]
    output = tmp_path / "yolo"

    with pytest.raises(ValueError, match="dimensions differ"):
        export_yolo_dataset(
            annotated, SEED_CLASSES, data_root, output, mode="whole_image"
        )

    assert not output.exists()
    assert not list(tmp_path.glob(".yolo-*"))


def test_yolo_export_refuses_a_corrupted_blob(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    annotated = _annotated_blobs(data_root, 2)
    blob_path(data_root, annotated[1].digest).write_bytes(encoded_image(variant=9))
    output = tmp_path / "yolo"

    with pytest.raises(BlobError, match="digest verification"):
        export_yolo_dataset(
            annotated, SEED_CLASSES, data_root, output, mode="whole_image"
        )

    assert not output.exists()


def test_yolo_export_refuses_a_missing_blob(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    annotated = _annotated_blobs(data_root, 2)
    blob_path(data_root, annotated[0].digest).unlink()

    with pytest.raises(BlobError, match="missing"):
        export_yolo_dataset(
            annotated, SEED_CLASSES, data_root, tmp_path / "yolo", mode="whole_image"
        )


def test_export_reads_recorded_splits_from_the_manifest(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    entries = []
    for variant, split in enumerate(("val", "train")):
        digest = write_blob(data_root, encoded_image(variant=variant))
        entries.append(
            manifest_entry(
                digest, split=split, annotation=annotation_document(digest, [])
            )
        )
    manifest_path = write_manifest(data_root, "batch", entries)

    annotated = load_dataset_manifest(manifest_path).annotated
    manifest = export_yolo_dataset(
        annotated, SEED_CLASSES, data_root, tmp_path / "yolo", mode="whole_image"
    )

    recorded = {entry["digest"]: entry["split"] for entry in entries}
    assert {entry["digest"]: entry["split"] for entry in manifest["images"]} == recorded


def test_yolo_export_honours_recorded_splits(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    annotated = _annotated_blobs(data_root, 3, splits=("val", "train", "train"))
    output = tmp_path / "yolo"
    manifest = export_yolo_dataset(
        annotated, SEED_CLASSES, data_root, output, mode="whole_image"
    )
    assert {entry["digest"]: entry["split"] for entry in manifest["images"]} == {
        image.digest: image.split for image in annotated
    }
    for entry in manifest["images"]:
        assert (output / entry["image"]).is_file()
        assert (output / entry["label"]).is_file()


@pytest.mark.parametrize("splits", [(), (None,), ("train", "train"), ("val", "val")])
def test_export_requires_training_and_validation_images(tmp_path, splits):
    from seedctl.detectors.ultralytics.dataset import DatasetSplitError

    images = [
        DatasetImage(str(index), 100, 80, (), tmp_path / str(index), split, None)
        for index, split in enumerate(splits)
    ]
    with pytest.raises(DatasetSplitError, match="both train and val"):
        export_dataset_images(
            images, SEED_CLASSES, tmp_path / "export", mode="whole_image"
        )
    assert not (tmp_path / "export").exists()


def test_dish_export_frames_pixels_and_labels_to_the_covered_dish(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    framed_digest = write_blob(data_root, encoded_image(variant=1))
    whole_digest = write_blob(data_root, encoded_image(variant=2))
    boxes = (
        AnnotationInstance("kept", "ungerminated", BoundingBox(30, 20, 10, 10)),
        AnnotationInstance("clipped", "ungerminated", BoundingBox(10, 15, 10, 10)),
        AnnotationInstance("dropped", "ungerminated", BoundingBox(0, 0, 4, 4)),
    )
    coverage = ImageCoverage(x=50.0, y=40.0, radius=30.0, margin=0.15)
    images = [
        DatasetImage(
            framed_digest,
            100,
            80,
            boxes,
            blob_path(data_root, framed_digest),
            "train",
            coverage,
        ),
        # A dish image whose analysis found no dish trains whole, as it is read.
        DatasetImage(
            whole_digest,
            100,
            80,
            boxes[:1],
            blob_path(data_root, whole_digest),
            "val",
            None,
        ),
    ]
    output = tmp_path / "yolo"

    manifest = export_dataset_images(
        images, SEED_CLASSES, output, link_images=True, mode="dish"
    )

    assert manifest["mode"] == "dish"
    # Reach 34.5 around (50, 40): x 15..85 and y 5..75, clipped to 80.
    framed, whole = sorted(
        manifest["images"], key=lambda e: e["digest"] != framed_digest
    )
    assert framed["window"] == {"x": 15, "y": 5, "width": 70, "height": 70}
    assert framed["image"] == f"images/train/{framed_digest}.png"
    assert framed["instances"] == 2
    pixels = read_image(output / framed["image"])
    assert pixels.shape == (70, 70, 3)
    assert (
        pixels == read_image(blob_path(data_root, framed_digest))[5:75, 15:85]
    ).all()
    assert (output / framed["label"]).read_text().splitlines() == [
        "0 0.28571429 0.28571429 0.14285714 0.14285714",
        "0 0.03571429 0.21428571 0.07142857 0.14285714",
    ]
    assert whole["window"] is None
    assert whole["image"] == f"images/val/{whole_digest}{CANONICAL_EXTENSION}"
    assert (output / whole["image"]).stat().st_ino == blob_path(
        data_root, whole_digest
    ).stat().st_ino

    with pytest.raises(ValueError, match="whole_image export frames no image"):
        export_dataset_images(
            images, SEED_CLASSES, tmp_path / "whole", mode="whole_image"
        )
    with pytest.raises(ValueError, match="Unknown inference mode"):
        export_dataset_images(images, SEED_CLASSES, tmp_path / "tiled", mode="tiled")  # type: ignore[arg-type]
