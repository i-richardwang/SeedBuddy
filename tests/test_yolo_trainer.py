"""Exercise dataset adaptation and checkpoint recovery with the pinned runtime."""

import json
import pickle
import shutil
import subprocess
import sys
from functools import partial
from pathlib import Path
from types import SimpleNamespace
from typing import Any

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
from seedctl.image_geometry.tiles import Tiling
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
    trainer.tiling = Tiling(640, 640)
    trainer.test_loader = SimpleNamespace(batch_size=1)
    trainer.save_dir = tmp_path
    trainer.args = get_cfg()
    trainer.callbacks = {}
    validator = trainer.get_validator()
    assert validator.args.batch == 1
    assert isinstance(validator, StoredImageValidator)
    assert validator.tiling == trainer.tiling


COVERAGE = ImageCoverage(x=50.0, y=40.0, radius=30.0, margin=0.15)
#: A dish frame, 70 pixels a side, read as it is stored.
FRAME = Tiling(70, 70)


def _coordinates(_path) -> np.ndarray:
    """A 100 by 80 image whose every pixel says where it is: (x, y, 0)."""
    pixels = np.zeros((80, 100, 3), np.uint8)
    pixels[..., 0] = np.arange(100)
    pixels[..., 1] = np.arange(80)[:, None]
    return pixels


def _dataset(
    tmp_path: Path, coverage: ImageCoverage | None, tiling: Tiling, *, mode="val"
) -> StoredImageDataset:
    """What the framework builds over exported images under `coverage`."""
    data_root = tmp_path / "data"
    box = AnnotationInstance("seed", SEED_CLASSES[0], BoundingBox(40, 30, 10, 10))
    images = []
    for variant, split in enumerate(("train", "train", "train", "val")):
        digest = write_blob(data_root, encoded_image(100, 80, variant))
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
    trainer = object.__new__(StoredImageDetectionTrainer)
    trainer.tiling = tiling
    trainer.args = get_cfg(overrides={"imgsz": tiling.tile})
    trainer.model = SimpleNamespace(stride=np.array([32]))
    trainer.data = {"names": dict(enumerate(SEED_CLASSES)), "channels": 3}
    dataset = trainer.build_dataset(str(output / "images" / mode), mode=mode, batch=1)
    assert isinstance(dataset, StoredImageDataset)
    return dataset


def test_detection_dataset_reads_a_whole_image_as_inference_does(tmp_path, monkeypatch):
    monkeypatch.setattr(image_loading, "read_image", _coordinates)
    dataset = _dataset(tmp_path, None, Tiling(100, 100))

    [sample] = [dataset.get_image_and_label(index) for index in range(len(dataset))]

    assert np.array_equal(sample["img"], _coordinates(None))
    assert sample["ori_shape"] == (80, 100)
    assert sample["instances"].bboxes.tolist() == [
        pytest.approx([0.45, 0.4375, 0.1, 0.125])
    ]
    assert dataset.batch_shapes.tolist() == [[96, 128]]


def test_detection_dataset_reads_the_dish_frame_as_inference_does(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(image_loading, "read_image", _coordinates)
    dataset = _dataset(tmp_path, COVERAGE, FRAME)

    pixels = dataset.get_image_and_label(0)["img"]

    # Reach 34.5 around (50, 40): x 15..85 and y 5..75.
    assert pixels.shape == (70, 70, 3)
    assert pixels[0, 0].tolist() == [15, 5, 0]
    assert pixels[-1, -1].tolist() == [84, 74, 0]
    # Validation batches take the shape of the frame, not of the stored image.
    assert dataset.batch_shapes.tolist() == [[96, 96]]


def test_validation_reads_every_tile_of_a_frame_with_the_objects_it_holds(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(image_loading, "read_image", _coordinates)
    dataset = _dataset(tmp_path, None, Tiling(100, 64))

    samples = [dataset.get_image_and_label(index) for index in range(len(dataset))]

    # Tiles start at x 0 and 36 and at y 0 and 16.
    assert [sample["img"][0, 0].tolist() for sample in samples] == [
        [0, 0, 0],
        [36, 0, 0],
        [0, 16, 0],
        [36, 16, 0],
    ]
    assert {sample["img"].shape for sample in samples} == {(64, 64, 3)}
    assert {sample["tiles"] for sample in samples} == {4}
    assert len({sample["im_file"] for sample in samples}) == 1
    # The object at 40..50 by 30..40 lies in all four, in each tile's own pixels.
    assert [(sample["instances"].bboxes[0] * 64).tolist() for sample in samples] == [
        pytest.approx([45, 35, 10, 10]),
        pytest.approx([9, 35, 10, 10]),
        pytest.approx([45, 19, 10, 10]),
        pytest.approx([9, 19, 10, 10]),
    ]
    classes, boxes = dataset.truth[samples[0]["im_file"]]
    assert classes.tolist() == [0.0]
    assert boxes.tolist() == [pytest.approx([40, 30, 50, 40])]


def test_training_draws_tiles_that_cover_each_frame_once(tmp_path, monkeypatch):
    monkeypatch.setattr(image_loading, "read_image", _coordinates)
    dataset = _dataset(tmp_path, None, Tiling(100, 64), mode="train")
    dataset.max_buffer_length = 2

    assert dataset.augment
    # Three frames, each four tiles' worth of area.
    assert len(dataset) == 12
    assert len({id(label) for label in dataset.labels}) == 12
    for index in range(len(dataset)):
        sample = dataset.get_image_and_label(index)
        assert sample["img"].shape == (64, 64, 3)
        assert "tile" not in sample
        x, y, _ = map(int, sample["img"][0, 0])
        assert 0 <= x <= 36 and 0 <= y <= 16
        # The object centred at (45, 35) is labelled where the drawn tile holds it.
        held = x <= 45 < x + 64 and y <= 35 < y + 64
        assert len(sample["cls"]) == held
        if held:
            centre = sample["instances"].bboxes[0, :2] * 64
            assert centre.tolist() == pytest.approx([45 - x, 35 - y])
    assert len(dataset.buffer) <= 2


def test_a_tile_clips_the_objects_that_cross_its_edge(tmp_path, monkeypatch):
    monkeypatch.setattr(image_loading, "read_image", _coordinates)
    dataset = _dataset(tmp_path, None, Tiling(100, 48))

    # Tiles start at x 0, 26 and 52: the middle one holds the centre of the
    # object at 40..50 by 30..40 whole, the tile at y 32 only its lower part.
    samples = [dataset.get_image_and_label(index) for index in range(len(dataset))]
    lower = next(
        sample for sample in samples if sample["img"][0, 0].tolist() == [26, 32, 0]
    )
    assert (lower["instances"].bboxes[0] * 48).tolist() == pytest.approx([19, 4, 10, 8])


def test_standalone_validation_reads_the_same_tiles_without_changing_global_loaders(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(image_loading, "read_image", _coordinates)
    training = _dataset(tmp_path, COVERAGE, FRAME)
    validator = object.__new__(StoredImageValidator)
    validator.tiling = FRAME
    validator.args = get_cfg(overrides={"imgsz": 70})
    validator.stride = 32
    validator.data = {"names": dict(enumerate(SEED_CLASSES)), "channels": 3}
    validation = validator.build_dataset(
        str(tmp_path / "dataset" / "images" / "val"), batch=1
    )
    assert np.array_equal(
        validation.get_image_and_label(0)["img"],
        training.get_image_and_label(0)["img"],
    )
    # Unrelated disk caches never override canonical pixels and crop windows.
    np.save(validation.npy_files[0], np.zeros((9, 13), dtype=np.uint8))
    validation._latest = None
    assert validation.get_image_and_label(0)["img"][0, 0].tolist() == [15, 5, 0]


def test_validation_scores_a_frame_once_from_what_each_tile_answers_for():
    import torch

    scored = []
    tiles = Tiling(100, 64).tiles(100, 64)
    validator: Any = object.__new__(StoredImageValidator)
    validator._reads = {}
    validator.seen = 0
    validator.device = "cpu"
    validator.args = SimpleNamespace(plots=False)
    validator.metrics = SimpleNamespace(update_stats=scored.append)
    validator.dataloader = SimpleNamespace(
        dataset=SimpleNamespace(
            truth={
                "frame.avif": (
                    np.array([0.0], np.float32),
                    np.array([[4, 4, 12, 12]], np.float32),
                )
            }
        )
    )
    validator._prepare_pred = lambda pred: pred
    validator._prepare_batch = lambda _index, _batch: None
    validator.scale_preds = lambda pred, _batch: pred
    validator._process_batch = lambda found, truth: {
        "found": found["bboxes"].tolist(),
        "truth": truth["bboxes"].tolist(),
    }

    def read() -> dict:
        # Each tile finds one object near its left edge and one near its right.
        return {
            "bboxes": torch.tensor([[4.0, 4.0, 12.0, 12.0], [50.0, 4.0, 58.0, 12.0]]),
            "conf": torch.tensor([0.9, 0.8]),
            "cls": torch.tensor([0.0, 1.0]),
        }

    for tile in tiles:
        assert not scored
        validator.update_metrics(
            [read()], {"tile": (tile,), "tiles": (2,), "im_file": ("frame.avif",)}
        )

    # The tiles meet at x 50: the left answers for its first object, the right
    # for its second, and the frame is matched against its one whole truth.
    [stats] = scored
    assert validator.seen == 1
    assert stats["found"] == [[4.0, 4.0, 12.0, 12.0], [86.0, 4.0, 94.0, 12.0]]
    assert stats["truth"] == [[4.0, 4.0, 12.0, 12.0]]
    assert stats["conf"].tolist() == pytest.approx([0.9, 0.8])
    assert stats["im_name"] == "frame.avif"
    validator._reads["half.avif"] = [read()]
    with pytest.raises(RuntimeError, match="every tile"):
        validator.finalize_metrics()


@pytest.mark.parametrize("damage", ["image", "label", "extra", "corrupt", "labels"])
def test_frozen_dataset_never_silently_drops_or_adds_samples(tmp_path, damage):
    dataset = _dataset(tmp_path, None, Tiling(320, 320), mode="train")
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
            tiling=Tiling(320, 320),
        )


def test_a_loader_process_started_afresh_reads_exported_images_the_same_way(tmp_path):
    handed = tmp_path / "dataset.pickle"
    handed.write_bytes(pickle.dumps(_dataset(tmp_path, COVERAGE, FRAME)))
    script = (
        "import pickle, sys\n"
        "dataset = pickle.load(open(sys.argv[1], 'rb'))\n"
        "print(dataset.get_image_and_label(0)['img'].shape)\n"
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
        "(70, 70, 3)",
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
