"""Stored-image training, validation and resume for the pinned Ultralytics runtime.

Imported lazily: the base seedctl installation does not require Ultralytics.
"""

from copy import copy
from pathlib import Path
from typing import Any, cast

import numpy as np
import torch
from ultralytics.models.yolo.detect.train import DetectionTrainer
from ultralytics.models.yolo.detect.val import DetectionValidator
from ultralytics.utils.torch_utils import unwrap_model

from seedctl.detectors.ultralytics.image_loading import stored_dataset
from seedctl.image_geometry.tiles import Tiling


class StoredImageValidator(DetectionValidator):
    """Score frames, not tiles: each tile contributes the predictions it
    answers for, and a frame is matched against its whole truth once every
    tile of it has been read."""

    def __init__(self, *args, tiling: Tiling, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.tiling = tiling
        self._reads: dict[str, list[dict[str, torch.Tensor]]] = {}

    def build_dataset(self, img_path, mode="val", batch=None):
        return stored_dataset(
            self.args,
            img_path,
            batch,
            self.data,
            tiling=self.tiling,
            mode=mode,
            stride=self.stride,
        )

    def init_metrics(self, model) -> None:
        super().init_metrics(model)
        self._reads = {}

    def update_metrics(self, preds, batch) -> None:
        for index, pred in enumerate(preds):
            tile = batch["tile"][index]
            file = batch["im_file"][index]
            found = self.scale_preds(
                self._prepare_pred(pred), self._prepare_batch(index, batch)
            )
            origin = tile.window.x, tile.window.y
            boxes = found["bboxes"] + found["bboxes"].new_tensor(origin * 2)
            centres = (boxes[:, :2] + boxes[:, 2:]) / 2
            owned = tile.owns(centres[:, 0], centres[:, 1])
            reads = self._reads.setdefault(file, [])
            reads.append(
                {key: value[owned] for key, value in {**found, "bboxes": boxes}.items()}
            )
            if len(reads) == batch["tiles"][index]:
                self._score(file, self._reads.pop(file))

    def _score(self, file: str, reads: list[dict[str, torch.Tensor]]) -> None:
        """Match one frame's merged predictions against its truth."""
        self.seen += 1
        found = {key: torch.cat([read[key] for read in reads]) for key in reads[0]}
        classes, boxes = cast(Any, self.dataloader).dataset.truth[file]
        truth = {
            "cls": torch.as_tensor(classes, device=self.device),
            "bboxes": torch.as_tensor(boxes, device=self.device),
        }
        empty = found["cls"].shape[0] == 0
        self.metrics.update_stats(
            {
                **self._process_batch(found, truth),
                "target_cls": classes,
                "target_img": np.unique(classes),
                "conf": np.zeros(0) if empty else found["conf"].cpu().numpy(),
                "pred_cls": np.zeros(0) if empty else found["cls"].cpu().numpy(),
                "im_name": Path(file).name,
            }
        )
        if self.args.plots:
            self.confusion_matrix.process_batch(
                found, truth, conf=self.confusion_matrix_conf
            )

    def finalize_metrics(self) -> None:
        if self._reads:
            raise RuntimeError("Validation ended before every tile of a frame was read")
        super().finalize_metrics()


class StoredImageDetectionTrainer(DetectionTrainer):
    """Own dataset adaptation and resume locations; bound validation memory."""

    def __init__(self, *args, tiling: Tiling, **kwargs) -> None:
        self.tiling = tiling
        super().__init__(*args, **kwargs)

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
            tiling=self.tiling,
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
            tiling=self.tiling,
        )
        validator.args.batch = self.test_loader.batch_size
        return validator
