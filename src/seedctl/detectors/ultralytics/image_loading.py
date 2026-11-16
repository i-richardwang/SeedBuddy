"""Explicit detection datasets over canonical stored images and frozen windows.

Imported lazily. No import changes Ultralytics' global loader or dataset factory.
The resize and bounded augmentation cache follow the pinned BaseDataset contract.
"""

import math
from copy import copy
from pathlib import Path
from typing import cast

import cv2
import numpy as np
from ultralytics.data.dataset import YOLODataset
from ultralytics.utils import colorstr

from seedctl.detectors.ultralytics.dataset import read_export
from seedctl.image_geometry.window import PixelWindow
from seedctl.io.image_io import read_image


class StoredImageDataset(YOLODataset):
    """Training, epoch validation and standalone validation share these pixels."""

    def get_labels(self) -> list[dict]:
        first = Path(self.im_files[0])
        root, split = first.parents[2], first.parent.name
        manifest = read_export(root)
        expected = {
            str(root / image["image"]): image
            for image in manifest["images"]
            if image["split"] == split
        }
        if set(self.im_files) != set(expected):
            raise ValueError("Dataset images differ from the frozen split")
        labels = super().get_labels()
        if {label["im_file"] for label in labels} != set(expected):
            raise ValueError("Dataset loader discarded frozen samples")
        self._windows = {
            file: PixelWindow(**image["window"]) for file, image in expected.items()
        }
        for label in labels:
            file = label["im_file"]
            if len(label["cls"]) != expected[file]["instances"]:
                raise ValueError(
                    f"Dataset labels differ from the frozen sample: {file}"
                )
            window = self._windows[file]
            label["shape"] = (window.height, window.width)
        return labels

    def load_image(
        self, i: int, rect_mode: bool = True, resize_short: bool = False
    ) -> tuple[np.ndarray, tuple[int, int], tuple[int, int]]:
        if self.ims[i] is not None:
            return (
                cast(np.ndarray, self.ims[i]),
                cast(tuple[int, int], self.im_hw0[i]),
                cast(tuple[int, int], self.im_hw[i]),
            )
        file = self.im_files[i]
        image = self._windows[file].of(read_image(file))
        h0, w0 = image.shape[:2]
        if rect_mode:
            ratio = self.imgsz / (min(h0, w0) if resize_short else max(h0, w0))
            if ratio != 1:
                w, h = math.ceil(w0 * ratio), math.ceil(h0 * ratio)
                if resize_short:
                    w, h = (w, self.imgsz) if h0 < w0 else (self.imgsz, h)
                else:
                    w, h = min(w, self.imgsz), min(h, self.imgsz)
                image = cv2.resize(image, (w, h), interpolation=cv2.INTER_LINEAR)
        elif (h0, w0) != (self.imgsz, self.imgsz):
            image = cv2.resize(
                image, (self.imgsz, self.imgsz), interpolation=cv2.INTER_LINEAR
            )
        if self.augment:
            # Upstream infers these mutable lists as list[None] at initialization.
            images = cast(list[np.ndarray | None], self.ims)
            originals = cast(list[tuple[int, int] | None], self.im_hw0)
            resized = cast(list[tuple[int, int] | None], self.im_hw)
            images[i], originals[i], resized[i] = (
                image,
                (h0, w0),
                image.shape[:2],
            )
            self.buffer.append(i)
            if 1 < len(self.buffer) >= self.max_buffer_length:
                oldest = self.buffer.pop(0)
                images[oldest], originals[oldest], resized[oldest] = (
                    None,
                    None,
                    None,
                )
        return image, (h0, w0), image.shape[:2]


def stored_dataset(args, img_path, batch, data, *, mode, stride, rect=False):
    """The detection-only part of the pinned factory, with an explicit dataset."""
    return StoredImageDataset(
        img_path=img_path,
        imgsz=args.imgsz,
        batch_size=batch,
        augment=mode == "train",
        hyp=copy(args),
        rect=args.rect or rect,
        cache=False,
        single_cls=args.single_cls or False,
        stride=stride,
        pad=0.0 if mode == "train" else 0.5,
        prefix=colorstr(f"{mode}: "),
        task="detect",
        classes=args.classes,
        data=data,
        fraction=1.0,
    )
