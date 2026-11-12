"""Exercise the real adapter hooks without loading weights or training a model."""

from types import SimpleNamespace

import pytest

pytest.importorskip("ultralytics")

from ultralytics.models.yolo.detect.train import DetectionTrainer

from seedctl.detectors.ultralytics.trainer import (
    MemoryBoundedDetectionTrainer,
)


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
