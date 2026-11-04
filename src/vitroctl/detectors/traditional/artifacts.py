from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from vitroctl.detectors.traditional.config import (
    PipelineConfig,
)
from vitroctl.detectors.traditional.pipeline import recognize
from vitroctl.detectors.traditional.results import CountResult
from vitroctl.detectors.traditional.scoring import CandidateModel


@dataclass(frozen=True)
class ImageArtifacts:
    """What local recognition writes for one image: the result and its rendered views."""

    result: CountResult
    result_json: bytes
    overlay_jpeg: bytes
    debug_jpeg: bytes


def _encode_jpeg(image: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".jpg", image)
    if not ok:
        raise ValueError("Unable to encode result image")
    return encoded.tobytes()


def create_image_artifacts(
    image_path: str | Path,
    *,
    config: PipelineConfig,
    model: CandidateModel,
) -> ImageArtifacts:
    recognition = recognize(image_path, config=config, model=model)
    result = recognition.result
    result_json = (
        json.dumps(result.to_dict(), ensure_ascii=False, indent=2) + "\n"
    ).encode("utf-8")
    return ImageArtifacts(
        result=result,
        result_json=result_json,
        overlay_jpeg=_encode_jpeg(recognition.overlay()),
        debug_jpeg=_encode_jpeg(recognition.debug()),
    )


def write_image_artifacts(artifacts: ImageArtifacts, output_dir: str | Path) -> None:
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    stem = artifacts.result.path.stem
    (destination / f"{stem}.json").write_bytes(artifacts.result_json)
    (destination / f"{stem}_overlay.jpg").write_bytes(artifacts.overlay_jpeg)
    (destination / f"{stem}_debug.jpg").write_bytes(artifacts.debug_jpeg)
