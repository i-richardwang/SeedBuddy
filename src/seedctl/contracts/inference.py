"""Inference settings the bundle records and the worker reads back."""

from __future__ import annotations

from typing import Literal

from seedctl.contracts.coverage import ModelArea

#: The worker's IoU is the build-time constant recorded by the bundle.
YOLO_IOU = 0.7

#: What a version is given to read: the whole image, or the dish framed by
#: its coverage. A version reads in the mode its snapshot was framed in.
InferenceMode = Literal["whole_image", "dish"]
INFERENCE_MODES: tuple[InferenceMode, ...] = ("whole_image", "dish")


def inference_mode_for_area(area: ModelArea) -> InferenceMode:
    """The mode a model area trains, and so the mode its versions read in."""
    if area == "dish":
        return "dish"
    if area == "image":
        return "whole_image"
    raise ValueError(f"Unknown model area: {area!r}")
