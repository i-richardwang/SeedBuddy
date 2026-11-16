"""Stored-image training, validation and resume for the pinned Ultralytics runtime.

Imported lazily: the base seedctl installation does not require Ultralytics.
"""

from copy import copy
from typing import Any, cast

from ultralytics.models.yolo.detect.train import DetectionTrainer
from ultralytics.models.yolo.detect.val import DetectionValidator
from ultralytics.utils.torch_utils import unwrap_model

from seedctl.detectors.ultralytics.image_loading import stored_dataset


class StoredImageValidator(DetectionValidator):
    def build_dataset(self, img_path, mode="val", batch=None):
        return stored_dataset(
            self.args, img_path, batch, self.data, mode=mode, stride=self.stride
        )


class StoredImageDetectionTrainer(DetectionTrainer):
    """Own dataset adaptation and resume locations; bound validation memory."""

    def check_resume(self, overrides):
        super().check_resume(overrides)
        # Frozen training arguments come from the checkpoint; run locations
        # come from the caller. Relocation never rewrites the checkpoint.
        for name in ("data", "project", "name", "save_dir", "exist_ok"):
            if name in overrides:
                setattr(self.args, name, overrides[name])

    def build_dataset(self, img_path, mode="train", batch=None):
        model: Any = unwrap_model(cast(Any, self.model))
        stride = max(int(model.stride.max()), 32)
        return stored_dataset(
            self.args,
            img_path,
            batch,
            self.data,
            mode=mode,
            stride=stride,
            rect=mode == "val",
        )

    def get_dataloader(self, dataset_path, batch_size=16, rank=0, mode="train"):
        if mode == "val":
            batch_size = min(batch_size, self.train_loader.batch_size)
        loader = super().get_dataloader(dataset_path, batch_size, rank, mode)
        if mode == "val" and self.validator is not None:
            # OOM recovery rebuilds the pipeline but retains the validator.
            self.validator.dataloader = loader
            self.validator.args.batch = loader.batch_size
        return loader

    def get_validator(self):
        validator = StoredImageValidator(
            self.test_loader,
            save_dir=self.save_dir,
            args=copy(self.args),
            _callbacks=self.callbacks,
        )
        validator.args.batch = self.test_loader.batch_size
        return validator
