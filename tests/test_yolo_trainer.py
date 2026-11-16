"""Exercise dataset adaptation and checkpoint recovery with the pinned runtime."""

import json
import pickle
import shutil
import subprocess
import sys
from functools import partial
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from conftest import PARAMETERS, SEED_CLASSES, encoded_image, write_blob

pytest.importorskip("ultralytics")

from ultralytics.cfg import get_cfg
from ultralytics.models.yolo.detect.train import DetectionTrainer

from seedctl.contracts.annotation import AnnotationInstance, BoundingBox
from seedctl.contracts.coverage import ImageCoverage
from seedctl.datasets.manifest import blob_path
from seedctl.detectors.ultralytics import image_loading
from seedctl.detectors.ultralytics.dataset import (
    DatasetImage,
    export_dataset_images,
    prepare_yolo_dataset,
)
from seedctl.detectors.ultralytics.image_loading import StoredImageDataset
from seedctl.detectors.ultralytics.trainer import (
    StoredImageDetectionTrainer,
    StoredImageValidator,
)
from seedctl.detectors.ultralytics.training import (
    YoloTrainingInterruptedError,
    train_yolo_detector,
)
from seedctl.io.files import file_digest


@pytest.mark.parametrize("actual_batch", [1, 2, 4])
def test_validation_uses_actual_per_device_batch(monkeypatch, actual_batch):
    calls = []

    def loader(self, path, batch_size, rank, mode):
        calls.append((batch_size, rank, mode))
        return SimpleNamespace(batch_size=batch_size)

    monkeypatch.setattr(DetectionTrainer, "get_dataloader", loader)
    trainer = object.__new__(StoredImageDetectionTrainer)
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


def test_validator_creation_sets_the_same_final_evaluation_batch(tmp_path):
    trainer = object.__new__(StoredImageDetectionTrainer)
    trainer.test_loader = SimpleNamespace(batch_size=1)
    trainer.save_dir = tmp_path
    trainer.args = get_cfg()
    trainer.callbacks = {}
    assert trainer.get_validator().args.batch == 1
    assert isinstance(trainer.get_validator(), StoredImageValidator)


COVERAGE = ImageCoverage(x=50.0, y=40.0, radius=30.0, margin=0.15)


def _coordinates(_path) -> np.ndarray:
    """A 100 by 80 image whose every pixel says where it is: (x, y, 0)."""
    pixels = np.zeros((80, 100, 3), np.uint8)
    pixels[..., 0] = np.arange(100)
    pixels[..., 1] = np.arange(80)[:, None]
    return pixels


def _dataset(
    tmp_path: Path, coverage: ImageCoverage | None, *, mode="val", size=(100, 80)
) -> StoredImageDataset:
    """What the framework builds for validation over exported images under `coverage`."""
    data_root = tmp_path / "data"
    box = AnnotationInstance("seed", SEED_CLASSES[0], BoundingBox(40, 30, 10, 10))
    images = []
    width, height = size
    for variant, split in enumerate(("train", "train", "train", "val")):
        digest = write_blob(data_root, encoded_image(width, height, variant))
        images.append(
            DatasetImage(
                digest,
                width,
                height,
                (box,),
                blob_path(data_root, digest),
                split,
                coverage,
            )
        )
    output = tmp_path / "dataset"
    export_dataset_images(
        images,
        SEED_CLASSES,
        output,
        mode="whole_image" if coverage is None else "dish",
    )
    trainer = object.__new__(StoredImageDetectionTrainer)
    trainer.args = get_cfg(overrides={"imgsz": 320})
    trainer.model = SimpleNamespace(stride=np.array([32]))
    trainer.data = {"names": dict(enumerate(SEED_CLASSES)), "channels": 3}
    dataset = trainer.build_dataset(str(output / "images" / mode), mode=mode, batch=1)
    assert isinstance(dataset, StoredImageDataset)
    return dataset


def test_detection_dataset_reads_a_whole_image_as_inference_does(tmp_path, monkeypatch):
    monkeypatch.setattr(image_loading, "read_image", _coordinates)
    dataset = _dataset(tmp_path, None)

    _pixels, original, _resized = dataset.load_image(0)

    assert original == (80, 100)
    assert dataset.batch_shapes.tolist() == [[288, 352]]


def test_detection_dataset_reads_the_dish_frame_as_inference_does(
    tmp_path, monkeypatch
):
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


def test_standalone_validation_reads_the_same_window_without_changing_global_loaders(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(image_loading, "read_image", _coordinates)
    training = _dataset(tmp_path, COVERAGE)
    validator = object.__new__(StoredImageValidator)
    validator.args = get_cfg(overrides={"imgsz": 70})
    validator.stride = 32
    validator.data = {"names": dict(enumerate(SEED_CLASSES)), "channels": 3}
    validation = validator.build_dataset(
        str(tmp_path / "dataset" / "images" / "val"), batch=1
    )
    training.imgsz = 70
    assert np.array_equal(validation.load_image(0)[0], training.load_image(0)[0])
    assert validation.load_image(0)[0][0, 0].tolist() == [15, 5, 0]
    # Unrelated disk caches never override canonical pixels and crop windows.
    validation.npy_files[0].write_bytes(b"")
    assert validation.load_image(0)[1] == (70, 70)
    np.save(validation.npy_files[0], np.zeros((9, 13), dtype=np.uint8))
    assert np.array_equal(validation.load_image(0)[0], training.load_image(0)[0])


def test_training_augmentation_uses_the_same_pixels_and_bounded_buffer(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(image_loading, "read_image", _coordinates)
    dataset = _dataset(tmp_path, COVERAGE, mode="train")
    dataset.imgsz = 70
    dataset.max_buffer_length = 2
    first = dataset.load_image(0)[0]
    assert first[0, 0].tolist() == [15, 5, 0]
    assert first[-1, -1].tolist() == [84, 74, 0]
    assert dataset.augment
    dataset.load_image(1)
    dataset.load_image(2)
    assert (
        sum(image.nbytes for image in dataset.ims if image is not None) <= first.nbytes
    )
    assert dataset.ims[0] is None
    assert np.array_equal(dataset.load_image(0)[0], first)


@pytest.mark.parametrize(
    "rect,short,shape",
    [(True, False, (256, 320)), (True, True, (320, 400)), (False, False, (320, 320))],
)
def test_image_loader_preserves_framework_resize_modes(tmp_path, rect, short, shape):
    dataset = _dataset(tmp_path, None)
    pixels, original, resized = dataset.load_image(
        0, rect_mode=rect, resize_short=short
    )
    assert original == (80, 100)
    assert resized == shape
    assert pixels.shape == (*shape, 3)


def test_short_side_resize_is_exact_at_a_floating_point_boundary(tmp_path):
    dataset = _dataset(tmp_path, None, size=(200, 147))
    assert dataset.load_image(0, resize_short=True)[2] == (320, 436)


@pytest.mark.parametrize("damage", ["image", "label", "extra", "corrupt", "labels"])
def test_frozen_dataset_never_silently_drops_or_adds_samples(tmp_path, damage):
    dataset = _dataset(tmp_path, None, mode="train")
    source = Path(dataset.im_files[0])
    root = source.parents[2]
    label = root / "labels/train" / source.with_suffix(".txt").name
    if damage == "image":
        source.unlink()
    elif damage == "label":
        label.unlink()
    elif damage == "extra":
        shutil.copy2(source, source.with_name("extra.avif"))
    elif damage == "corrupt":
        source.write_bytes(b"corrupt")
    else:
        label.write_text("")
    with pytest.raises(ValueError, match="[Ff]rozen"):
        StoredImageDataset(
            img_path=str(source.parent),
            data=dataset.data,
            hyp=get_cfg(),
            imgsz=320,
            batch_size=1,
            augment=False,
        )


def test_a_loader_process_started_afresh_reads_exported_images_the_same_way(tmp_path):
    handed = tmp_path / "dataset.pickle"
    handed.write_bytes(pickle.dumps(_dataset(tmp_path, COVERAGE)))
    script = (
        "import pickle, sys\n"
        "dataset = pickle.load(open(sys.argv[1], 'rb'))\n"
        "print(dataset.load_image(0)[1])\n"
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

    assert answer.stdout.splitlines() == [
        "(70, 70)",
        "ultralytics.utils.patches ultralytics.data.dataset",
    ]


def test_real_checkpoint_resumes_in_a_relocated_run_with_a_migrated_export(
    tmp_path, monkeypatch
):
    import torch
    from test_yolo import _annotated_blobs
    from ultralytics import YOLO
    from ultralytics.utils.patches import torch_load

    from seedctl.detectors.ultralytics.dataset import export_yolo_dataset

    data = tmp_path / "sources"
    images = _annotated_blobs(data, 4, ("train", "train", "val", "val"))
    exported = tmp_path / "dataset"
    manifest = export_yolo_dataset(
        images, SEED_CLASSES, data, exported, mode="whole_image"
    )
    model = tmp_path / "base.pt"
    YOLO("yolo26n.yaml").save(model)
    parameters = {
        **PARAMETERS,
        "epochs": 2,
        "imgsz": 64,
        "batch": 2,
        "workers": 0,
        "plots": False,
        "amp": False,
    }
    train = partial(
        train_yolo_detector,
        parameters=parameters,
        model=model,
        model_digest=file_digest(model),
        runtime_version="8.4.131",
        device="cpu",
    )
    original = tmp_path / "original"

    def interrupt(report):
        if report.epoch == 1:
            raise YoloTrainingInterruptedError("pause")

    with pytest.raises(YoloTrainingInterruptedError, match="pause"):
        train(
            exported / "dataset.yaml",
            original,
            resume_required=False,
            on_epoch=interrupt,
        )
    relocated = tmp_path / "relocated"
    shutil.move(original, relocated)
    checkpoint = relocated / "weights/last.pt"
    state = torch_load(checkpoint, map_location="cpu")
    assert state["epoch"] == 0 and state["optimizer"] is not None
    frozen = file_digest(checkpoint)
    manifest.pop("layout_version")
    (exported / "manifest.json").write_text(json.dumps(manifest))
    shutil.rmtree(data)
    dataset = prepare_yolo_dataset(
        images, SEED_CLASSES, data, exported, mode="whole_image", seed=999
    )
    moved_dataset = tmp_path / "frozen-dataset"
    shutil.move(dataset.parent, moved_dataset)
    shutil.rmtree(exported)
    dataset = moved_dataset / "dataset.yaml"
    epochs = []
    executed = []
    restored = []
    resume = StoredImageDetectionTrainer.resume_training

    def restore(trainer, checkpoint):
        resume(trainer, checkpoint)
        assert trainer.start_epoch == 1
        torch.testing.assert_close(
            trainer.optimizer.state_dict()["state"],
            state["optimizer"]["state"],
            check_dtype=False,
            rtol=0,
            atol=0,
        )
        restored.append(True)
        trainer.add_callback(
            "on_train_epoch_start", lambda current: executed.append(current.epoch + 1)
        )

    monkeypatch.setattr(StoredImageDetectionTrainer, "resume_training", restore)

    def started():
        assert file_digest(checkpoint) == frozen

    result = train(
        dataset,
        relocated,
        resume_required=True,
        on_training_start=started,
        on_epoch=lambda report: epochs.append(report.epoch),
    )
    assert epochs == [1, 2]
    assert executed == [2] and restored == [True]
    assert result.best_weights == relocated / "weights/best.pt"
    execution = json.loads((relocated / "execution.json").read_text())
    assert execution["parameters"]["data"] == str(dataset)
    assert execution["parameters"]["save_dir"] == str(relocated)
    assert result.summary.is_file()
