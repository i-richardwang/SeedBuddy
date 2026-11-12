from __future__ import annotations

import gc
from importlib.metadata import PackageNotFoundError, version


def ultralytics_installed() -> bool:
    try:
        version("ultralytics")
    except PackageNotFoundError:
        return False
    return True


def load_yolo() -> type:
    if not ultralytics_installed():
        raise RuntimeError(
            "Ultralytics is not installed; run `uv sync --extra yolo` first"
        )
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
    from seedctl.detectors.ultralytics.trainer import MemoryBoundedDetectionTrainer

    return MemoryBoundedDetectionTrainer


def require_ultralytics_version(required: str) -> None:
    installed = version("ultralytics")
    if installed != required:
        raise ValueError(f"Requires ultralytics {required}; installed {installed}")
