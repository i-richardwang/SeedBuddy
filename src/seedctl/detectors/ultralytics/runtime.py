from __future__ import annotations

import gc
import os
from importlib.metadata import PackageNotFoundError, version

# PyTorch lets its Metal allocator hold 1.7 times the working set macOS
# recommends, more than a Mac has, so a run that fills it swaps where it should
# fail. Held to the recommendation the allocator reuses what it released, and
# a run that needs more raises the out-of-memory error training recovers from.
MPS_MEMORY_BOUNDS = {
    "PYTORCH_MPS_HIGH_WATERMARK_RATIO": "1.0",
    "PYTORCH_MPS_LOW_WATERMARK_RATIO": "0.8",
}


def ultralytics_installed() -> bool:
    try:
        version("ultralytics")
    except PackageNotFoundError:
        return False
    return True


def load_yolo() -> type:
    """The YOLO runtime, its Metal memory bounded unless the operator set it."""
    if not ultralytics_installed():
        raise RuntimeError(
            "Ultralytics is not installed; run `uv sync --extra yolo` first"
        )
    if not MPS_MEMORY_BOUNDS.keys() & os.environ.keys():
        os.environ.update(MPS_MEMORY_BOUNDS)
    try:
        from ultralytics import YOLO
    except Exception as error:
        raise RuntimeError("Ultralytics is installed but cannot be imported") from error
    return YOLO


def release_accelerator() -> None:
    """Release unreachable runtime objects and their cached device allocations."""
    gc.collect()
    try:
        import torch
    except ImportError:
        return
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()


def load_training_trainer() -> type:
    """Load the detection adapter only when training is requested."""
    from seedctl.detectors.ultralytics.trainer import StoredImageDetectionTrainer

    return StoredImageDetectionTrainer


def require_ultralytics_version(required: str) -> None:
    installed = version("ultralytics")
    if installed != required:
        raise ValueError(f"Requires ultralytics {required}; installed {installed}")


def load_training_validator() -> type:
    from seedctl.detectors.ultralytics.trainer import StoredImageValidator

    return StoredImageValidator
