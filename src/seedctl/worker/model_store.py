"""Validates and loads the immutable model manifests assigned by the Server."""

from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from seedctl.detectors.contract import Detector
from seedctl.detectors.traditional.config import (
    DEFAULT_PIPELINE_CONFIG,
)
from seedctl.detectors.traditional.detector import (
    TRADITIONAL_CLASS,
    TraditionalDetector,
)
from seedctl.detectors.traditional.scoring import DEFAULT_MODEL
from seedctl.detectors.ultralytics.detector import (
    UltralyticsDetector,
    YoloInferenceSettings,
)
from seedctl.detectors.ultralytics.runtime import (
    release_accelerator,
    require_ultralytics_version,
)
from seedctl.io.files import atomic_directory, content_digest, verify_digest

CACHE_VALIDATION_ERRORS = (OSError, TypeError, ValueError, RuntimeError)
LOGGER = logging.getLogger(__name__)


class WeightsSource(Protocol):
    def weights(self, version_id: str, deadline: float) -> bytes: ...


@dataclass(frozen=True)
class ModelManifest:
    """The immutable model identity and artifact an assignment executes."""

    model_version_id: str
    classes: tuple[str, ...]
    artifact: dict[str, Any]

    @classmethod
    def decode(cls, value: Any, context: str) -> ModelManifest:
        return cls(
            model_version_id=value["modelVersionId"],
            classes=tuple(value["classes"]),
            artifact=value["artifact"],
        )


class ModelStore:
    """
    Materializes assigned versions into detectors. Downloaded YOLO
    artifacts stay on disk under ``model-artifacts/<version>``; only the
    most recently loaded model stays in memory.
    """

    def __init__(self, source: WeightsSource, work_dir: Path, device: str | None):
        self._source = source
        self._artifacts = work_dir / "model-artifacts"
        self._device = device
        self._loaded: tuple[str, Detector] | None = None

    def load(self, manifest: ModelManifest, deadline: float) -> Detector:
        version_id = manifest.model_version_id
        if self._loaded and self._loaded[0] == version_id:
            return self._loaded[1]
        self.unload()
        artifact = manifest.artifact
        if artifact["kind"] == "ultralytics":
            detector: Detector = self._ultralytics_detector(
                version_id, manifest.classes, artifact, deadline
            )
        else:
            if TRADITIONAL_CLASS not in manifest.classes:
                raise ValueError(
                    f"Traditional detector requires a model that declares {TRADITIONAL_CLASS}"
                )
            detector = TraditionalDetector(DEFAULT_PIPELINE_CONFIG, DEFAULT_MODEL)
            if detector.artifact_digest != artifact["digest"]:
                raise ValueError(
                    f"Local artifact for {version_id} does not match the published digest"
                )
        self._loaded = (version_id, detector)
        LOGGER.info("loaded %s", version_id)
        return detector

    def unload(self) -> None:
        if self._loaded is None:
            return
        self._loaded = None
        release_accelerator()

    def _ultralytics_detector(
        self,
        version_id: str,
        classes: tuple[str, ...],
        artifact: dict[str, Any],
        deadline: float,
    ) -> UltralyticsDetector:
        required_runtime = artifact["training"]["runtime"]["version"]
        require_ultralytics_version(required_runtime)
        expected_digest = artifact["digest"]
        inference = artifact["inference"]
        settings = YoloInferenceSettings.decode(
            inference, "model manifest.artifact.inference"
        )
        destination = self._artifacts / version_id
        if destination.exists():
            try:
                return self._verified_ultralytics_detector(
                    destination, classes, expected_digest, settings
                )
            except CACHE_VALIDATION_ERRORS as error:
                LOGGER.warning("discarding invalid cache for %s: %s", version_id, error)
                shutil.rmtree(destination)

        with atomic_directory(destination) as temporary:
            weights = temporary / "weights" / "best.pt"
            weights.parent.mkdir(parents=True)
            content = self._source.weights(version_id, deadline)
            if len(content) != artifact["weights"]["bytes"]:
                raise ValueError("Downloaded YOLO weights have an unexpected size")
            verify_digest(content_digest(content), artifact["weights"]["digest"])
            weights.write_bytes(content)
        return self._verified_ultralytics_detector(
            destination, classes, expected_digest, settings
        )

    def _verified_ultralytics_detector(
        self,
        artifact_directory: Path,
        classes: tuple[str, ...],
        expected_digest: str,
        settings: YoloInferenceSettings,
    ) -> UltralyticsDetector:
        cached = UltralyticsDetector(
            artifact_directory / "weights" / "best.pt", settings, classes, self._device
        )
        if cached.artifact_digest != expected_digest:
            raise ValueError("YOLO artifact does not match its published digest")
        return cached
