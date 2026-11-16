"""Exported images read by the pinned Ultralytics trainer as inference reads them.

A dataset holds stored images and, for each, the window of it that is
trained on. The framework's datasets read every file through one function of
its own and take an image's shape from the file; importing this module puts
`read_image` and the window in their place, in the importing process, by
replacing the function and the dataset class the framework builds.

Imported lazily: the base seedctl installation does not require Ultralytics.
"""

from pathlib import Path

import cv2
import numpy as np
import ultralytics.data.base as framework_loading
import ultralytics.data.build as framework_building
from ultralytics.data.dataset import YOLODataset

from seedctl.detectors.ultralytics.dataset import exported_window
from seedctl.io.image_io import read_image


def _read(filename: str | Path, flags: int = cv2.IMREAD_COLOR) -> np.ndarray:
    """An exported image's trained pixels; the framework asks for them in colour."""
    return exported_window(filename).of(read_image(filename))


class StoredImageDataset(YOLODataset):
    """
    The framework's dataset over exported images. A loader process started
    afresh imports this module when it is handed the dataset.
    """

    def get_labels(self) -> list[dict]:
        """Labels whose shape, which orders rectangular batches, is the window's."""
        labels = super().get_labels()
        for label in labels:
            window = exported_window(label["im_file"])
            label["shape"] = (window.height, window.width)
        return labels


# The names are the framework's own, not ones it offers: the tests of the
# trainer check them against the pinned version.
framework_loading.imread = _read  # pyright: ignore[reportPrivateImportUsage]
framework_building.YOLODataset = StoredImageDataset  # pyright: ignore[reportPrivateImportUsage]
