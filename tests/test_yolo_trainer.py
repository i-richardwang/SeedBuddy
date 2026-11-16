"""Exercise the real adapter hooks without loading weights or training a model."""

import pickle
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from conftest import SEED_CLASSES, encoded_image, write_blob

pytest.importorskip("ultralytics")

from ultralytics.cfg import get_cfg
from ultralytics.data.build import build_yolo_dataset
from ultralytics.models.yolo.detect.train import DetectionTrainer

from seedctl.contracts.annotation import AnnotationInstance, BoundingBox
from seedctl.contracts.coverage import ImageCoverage
from seedctl.datasets.manifest import blob_path
from seedctl.detectors.ultralytics import image_loading
from seedctl.detectors.ultralytics.dataset import DatasetImage, export_dataset_images
from seedctl.detectors.ultralytics.image_loading import StoredImageDataset
from seedctl.detectors.ultralytics.trainer import MemoryBoundedDetectionTrainer


@pytest.mark.parametrize("actual_batch", [1, 2, 4])
def test_validation_uses_actual_per_device_batch(monkeypatch, actual_batch):
    calls = []

    def loader(self, path, batch_size, rank, mode):
        calls.append((batch_size, rank, mode))
        return SimpleNamespace(batch_size=batch_size)

    monkeypatch.setattr(DetectionTrainer, "get_dataloader", loader)
    trainer = object.__new__(MemoryBoundedDetectionTrainer)
    trainer.train_loader = SimpleNamespace(batch_size=actual_batch)
    trainer.validator = None
    train = trainer.get_dataloader("train", batch_size=4, mode="train")
    val = trainer.get_dataloader("val", batch_size=8, mode="val")
    assert train.batch_size == 4
    assert val.batch_size == actual_batch
    assert calls == [(4, 0, "train"), (actual_batch, 0, "val")]

    # OOM recovery replaces both the loader and the existing validator's loader;
    # epoch validation and final_eval must not retain the old, larger batch.
    trainer.validator = SimpleNamespace(dataloader=val, args=SimpleNamespace(batch=4))
    trainer.train_loader = SimpleNamespace(batch_size=1)
    reduced = trainer.get_dataloader("val", batch_size=2, mode="val")
    assert trainer.validator.dataloader is reduced
    assert trainer.validator.args.batch == 1
    assert reduced.batch_size == 1


def test_validator_creation_sets_the_same_final_evaluation_batch(monkeypatch):
    trainer = object.__new__(MemoryBoundedDetectionTrainer)
    trainer.test_loader = SimpleNamespace(batch_size=1)
    validator = SimpleNamespace(args=SimpleNamespace(batch=4))
    monkeypatch.setattr(DetectionTrainer, "get_validator", lambda _: validator)
    assert trainer.get_validator().args.batch == 1


COVERAGE = ImageCoverage(x=50.0, y=40.0, radius=30.0, margin=0.15)


def _coordinates(_path) -> np.ndarray:
    """A 100 by 80 image whose every pixel says where it is: (x, y, 0)."""
    pixels = np.zeros((80, 100, 3), np.uint8)
    pixels[..., 0] = np.arange(100)
    pixels[..., 1] = np.arange(80)[:, None]
    return pixels


def _dataset(tmp_path: Path, coverage: ImageCoverage | None) -> StoredImageDataset:
    """What the framework builds for validation over exported images under `coverage`."""
    data_root = tmp_path / "data"
    box = AnnotationInstance("seed", SEED_CLASSES[0], BoundingBox(40, 30, 10, 10))
    images = []
    for variant, split in enumerate(("train", "val")):
        digest = write_blob(data_root, encoded_image(variant=variant))
        images.append(
            DatasetImage(
                digest, 100, 80, (box,), blob_path(data_root, digest), split, coverage
            )
        )
    output = tmp_path / "dataset"
    export_dataset_images(
        images,
        SEED_CLASSES,
        output,
        mode="whole_image" if coverage is None else "dish",
    )
    dataset = build_yolo_dataset(
        get_cfg(overrides={"imgsz": 320}),  # pyright: ignore[reportArgumentType]
        str(output / "images" / "val"),
        1,
        {"names": dict(enumerate(SEED_CLASSES)), "channels": 3},
        mode="val",
        rect=True,
    )
    assert isinstance(dataset, StoredImageDataset)
    return dataset


def test_training_reads_a_whole_image_as_inference_reads_it(tmp_path, monkeypatch):
    monkeypatch.setattr(image_loading, "read_image", _coordinates)
    dataset = _dataset(tmp_path, None)

    _pixels, original, _resized = dataset.load_image(0)

    assert original == (80, 100)
    assert dataset.batch_shapes.tolist() == [[288, 352]]


def test_training_reads_the_frame_of_a_dish_that_inference_reads(tmp_path, monkeypatch):
    monkeypatch.setattr(image_loading, "read_image", _coordinates)
    dataset = _dataset(tmp_path, COVERAGE)
    dataset.imgsz = 70  # the frame's own size, so that its pixels are not resampled

    pixels, original, _resized = dataset.load_image(0)

    # Reach 34.5 around (50, 40): x 15..85 and y 5..75.
    assert original == (70, 70)
    assert pixels[0, 0].tolist() == [15, 5, 0]
    assert pixels[-1, -1].tolist() == [84, 74, 0]
    # Validation batches take the shape of the frame, not of the stored image.
    assert dataset.batch_shapes.tolist() == [[352, 352]]


def test_a_loader_process_started_afresh_reads_exported_images_the_same_way(tmp_path):
    handed = tmp_path / "dataset.pickle"
    handed.write_bytes(pickle.dumps(_dataset(tmp_path, COVERAGE)))
    script = (
        "import pickle, sys\n"
        "pickle.load(open(sys.argv[1], 'rb'))\n"
        "import ultralytics.data.base as loading\n"
        "import ultralytics.data.build as building\n"
        "print(loading.imread.__module__, building.YOLODataset.__module__)\n"
    )

    answer = subprocess.run(
        [sys.executable, "-c", script, str(handed)],
        capture_output=True,
        text=True,
        check=True,
    )

    assert answer.stdout.split() == [image_loading.__name__] * 2
