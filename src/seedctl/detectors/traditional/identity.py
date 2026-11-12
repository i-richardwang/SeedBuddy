from __future__ import annotations

import hashlib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from seedctl.detectors.traditional.config import PipelineConfig
from seedctl.detectors.traditional.scoring import CandidateModel

PIPELINE_NAME = "traditional-seed-counting"

_PIPELINE_FILES = (
    "candidates.py",
    "config.py",
    "detection.py",
    "geometry.py",
    "../../io/image_io.py",
    "../../image_geometry/dish.py",
    "../../image_geometry/recipe.py",
    "../../image_geometry/dish-recipe.json",
    "identity.py",
    "results.py",
    "regions.py",
    "rendering.py",
    "normalization.py",
    "pipeline.py",
    "proposals.py",
    "scoring.py",
)


@lru_cache(maxsize=1)
def pipeline_fingerprint() -> str:
    package_dir = Path(__file__).parent
    digest = hashlib.sha256()
    for name in _PIPELINE_FILES:
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update((package_dir / name).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


@dataclass(frozen=True)
class ExecutionIdentity:
    """Pipeline, model, and configuration that produced a set of results."""

    pipeline_name: str
    pipeline_fingerprint: str
    model_name: str
    model_fingerprint: str
    config: PipelineConfig

    @classmethod
    def create(cls, config: PipelineConfig, model: CandidateModel) -> ExecutionIdentity:
        return cls(
            PIPELINE_NAME,
            pipeline_fingerprint(),
            model.name,
            model.fingerprint,
            config,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "pipeline": {
                "name": self.pipeline_name,
                "fingerprint": self.pipeline_fingerprint,
            },
            "model": {"name": self.model_name, "fingerprint": self.model_fingerprint},
            "config": self.config.to_dict(),
        }
