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

from vitroctl.contracts.annotation import (
    AnnotationInstance,
    BoundingBox,
)
from vitroctl.datasets.manifest import (
    AnnotatedImage,
    BlobError,
    blob_path,
    load_dataset_manifest,
)
from vitroctl.detectors.ultralytics import (
    DatasetImage,
    export_dataset_images,
    export_yolo_dataset,
)
from vitroctl.detectors.ultralytics.dataset import assign_splits
from vitroctl.io.image_io import CANONICAL_EXTENSION


def _annotated(digest: str, split: str | None = None) -> AnnotatedImage:
    return AnnotatedImage(
        digest=digest,
        width=100,
        height=80,
        filename=f"{digest[:4]}.jpg",
        bytes=1,
        split=split,
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
    manifest = export_yolo_dataset(annotated, SEED_CLASSES, data_root, output, seed=7)

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
        export_yolo_dataset(annotated, SEED_CLASSES, data_root, output, seed=7)


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
        annotated, SEED_CLASSES, data_root, tmp_path / "one", seed=3
    )
    second = export_yolo_dataset(
        annotated[::-1], SEED_CLASSES, data_root, tmp_path / "two", seed=3
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
        export_yolo_dataset(annotated, SEED_CLASSES, data_root, output)

    assert not output.exists()
    assert not list(tmp_path.glob(".yolo-*"))


def test_yolo_export_refuses_a_corrupted_blob(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    annotated = _annotated_blobs(data_root, 2)
    blob_path(data_root, annotated[1].digest).write_bytes(encoded_image(variant=9))
    output = tmp_path / "yolo"

    with pytest.raises(BlobError, match="digest verification"):
        export_yolo_dataset(annotated, SEED_CLASSES, data_root, output)

    assert not output.exists()


def test_yolo_export_refuses_a_missing_blob(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    annotated = _annotated_blobs(data_root, 2)
    blob_path(data_root, annotated[0].digest).unlink()

    with pytest.raises(BlobError, match="missing"):
        export_yolo_dataset(annotated, SEED_CLASSES, data_root, tmp_path / "yolo")


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
        annotated, SEED_CLASSES, data_root, tmp_path / "yolo"
    )

    recorded = {entry["digest"]: entry["split"] for entry in entries}
    assert {entry["digest"]: entry["split"] for entry in manifest["images"]} == recorded


def test_yolo_export_honours_recorded_splits(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    annotated = _annotated_blobs(data_root, 3, splits=("val", "train", "train"))
    output = tmp_path / "yolo"
    manifest = export_yolo_dataset(annotated, SEED_CLASSES, data_root, output)
    assert {entry["digest"]: entry["split"] for entry in manifest["images"]} == {
        image.digest: image.split for image in annotated
    }
    for entry in manifest["images"]:
        assert (output / entry["image"]).is_file()
        assert (output / entry["label"]).is_file()


@pytest.mark.parametrize("splits", [(), (None,), ("train", "train"), ("val", "val")])
def test_export_requires_training_and_validation_images(tmp_path, splits):
    from vitroctl.detectors.ultralytics.dataset import DatasetSplitError

    images = [
        DatasetImage(str(index), 100, 80, (), tmp_path / str(index), split)
        for index, split in enumerate(splits)
    ]
    with pytest.raises(DatasetSplitError, match="both train and val"):
        export_dataset_images(images, SEED_CLASSES, tmp_path / "export")
    assert not (tmp_path / "export").exists()
