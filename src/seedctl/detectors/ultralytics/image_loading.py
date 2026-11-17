"""Explicit detection datasets over canonical stored images and frozen windows.

Imported lazily. No import changes Ultralytics' global loader or dataset factory.
The sample, rectangle and augmentation buffer handling follow the pinned
BaseDataset contract.
"""

from copy import copy, deepcopy
from functools import cached_property
from pathlib import Path
from typing import Any

import numpy as np
from ultralytics.data.dataset import YOLODataset
from ultralytics.utils import colorstr

from seedctl.detectors.ultralytics.dataset import read_export
from seedctl.image_geometry.tiles import Tiling
from seedctl.image_geometry.window import PixelWindow
from seedctl.io.image_io import read_image


class StoredImageDataset(YOLODataset):
    """Training, epoch validation and standalone validation share these pixels.

    A sample is one tile of a frame at the tiling's resolution. Validation
    reads every tile of each frame and names it, so that the frame can be put
    together again. Training draws, each epoch, as many tiles of a frame as
    cover it once, each anywhere in the frame.
    """

    def __init__(self, *args, tiling: Tiling, **kwargs) -> None:
        self.tiling = tiling
        self._latest: tuple[str, np.ndarray] | None = None
        super().__init__(*args, **kwargs)

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
        samples = []
        for label in labels:
            file = label["im_file"]
            if len(label["cls"]) != expected[file]["instances"]:
                raise ValueError(
                    f"Dataset labels differ from the frozen sample: {file}"
                )
            samples += [{**label, **read} for read in self._reads(file)]
        self.im_files = [sample["im_file"] for sample in samples]
        return samples

    def _reads(self, file: str) -> list[dict[str, Any]]:
        """What tells the samples of one frame apart: the tile each reads and
        how many make up the frame, or for training only the shape of the
        tile each will draw."""
        width, height = self._size(file)
        if self.augment:
            drawn = (min(self.tiling.tile, height), min(self.tiling.tile, width))
            return [{"shape": drawn}] * self.tiling.passes(width, height)
        tiles = self.tiling.tiles(width, height)
        return [
            {
                "shape": (tile.window.height, tile.window.width),
                "tile": tile,
                "tiles": len(tiles),
            }
            for tile in tiles
        ]

    def set_rectangle(self) -> None:
        """Upstream's batch shapes in a stable order, so the tiles of one frame
        stay together and its pixels are decoded once."""
        batch = np.floor(np.arange(self.ni) / self.batch_size).astype(int)
        shapes = np.array([label.pop("shape") for label in self.labels])
        ratios = shapes[:, 0] / shapes[:, 1]
        order = ratios.argsort(kind="stable")
        self.im_files = [self.im_files[index] for index in order]
        self.labels = [self.labels[index] for index in order]
        ratios = ratios[order]
        batch_shapes = [[1.0, 1.0]] * (batch[-1] + 1)
        for index in range(len(batch_shapes)):
            lowest, highest = ratios[batch == index].min(), ratios[batch == index].max()
            if highest < 1:
                batch_shapes[index] = [highest, 1.0]
            elif lowest > 1:
                batch_shapes[index] = [1.0, 1 / lowest]
        self.batch_shapes = (
            np.ceil(
                np.array(batch_shapes) * self.imgsz / self.stride + self.pad
            ).astype(int)
            * self.stride
        )
        self.batch = batch

    def _size(self, file: str) -> tuple[int, int]:
        """The width and height a frame is read at."""
        window = self._windows[file]
        return self.tiling.size(window.width, window.height)

    def _frame(self, file: str) -> np.ndarray:
        """A frame's pixels at the tiling's resolution. The latest frame is
        kept: validation reads the tiles of a frame one after another."""
        if self._latest is None or self._latest[0] != file:
            pixels = self.tiling.scale(self._windows[file].of(read_image(file)))
            self._latest = (file, pixels)
        return self._latest[1]

    @cached_property
    def truth(self) -> dict[str, tuple[np.ndarray, np.ndarray]]:
        """Each frame's classes and its boxes, as corners in the pixels the
        frame is read at."""
        return {
            label["im_file"]: (
                label["cls"][:, 0],
                _corners(label["bboxes"], *self._size(label["im_file"])),
            )
            for label in self.labels
        }

    def get_image_and_label(self, index: int) -> dict[str, Any]:
        label = deepcopy(self.labels[index])
        label.pop("shape", None)
        frame = self._frame(label["im_file"])
        height, width = frame.shape[:2]
        window = (
            self.tiling.draw(width, height) if self.augment else label["tile"].window
        )
        # A tile labels the objects it holds the centre of, clipped to itself.
        corners = _corners(label["bboxes"], width, height)
        centres = (corners[:, :2] + corners[:, 2:]) / 2
        held = window.holds(centres[:, 0], centres[:, 1])
        boxes = corners[held] - np.array(
            [window.x, window.y, window.x, window.y], dtype=np.float32
        )
        boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, window.width) / window.width
        boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, window.height) / window.height
        label["bboxes"] = np.concatenate(
            ((boxes[:, :2] + boxes[:, 2:]) / 2, boxes[:, 2:] - boxes[:, :2]), axis=1
        )
        label["cls"] = label["cls"][held]
        label["img"] = window.of(frame).copy()
        label["ori_shape"] = label["resized_shape"] = (window.height, window.width)
        label["ratio_pad"] = (1.0, 1.0)
        if self.rect:
            label["rect_shape"] = self.batch_shapes[self.batch[index]]
        if self.augment:
            self.buffer.append(index)
            if 1 < len(self.buffer) >= self.max_buffer_length:
                self.buffer.pop(0)
        return self.update_labels_info(label)


def _corners(boxes: np.ndarray, width: int, height: int) -> np.ndarray:
    """Normalised centre-size boxes as corners in pixels."""
    centre, size = boxes[:, :2], boxes[:, 2:]
    return np.concatenate((centre - size / 2, centre + size / 2), axis=1) * np.array(
        [width, height, width, height], dtype=np.float32
    )


def stored_dataset(
    args, img_path, batch, data, *, tiling: Tiling, mode, stride, rect=False
):
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
        tiling=tiling,
    )
