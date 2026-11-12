from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from seedctl.detectors.traditional.identity import ExecutionIdentity


@dataclass(frozen=True)
class SeedDetection:
    detection_id: int
    x: float
    y: float
    scale: float
    score: float

    def to_dict(self) -> dict[str, int | float]:
        return {
            "id": self.detection_id,
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "scale": round(self.scale, 2),
            "score": round(self.score, 3),
        }


@dataclass(frozen=True)
class QualityReport:
    status: str
    warnings: tuple[str, ...]
    clipped_fraction: float
    focus_score: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "warnings": list(self.warnings),
            "clipped_fraction": round(self.clipped_fraction, 6),
            "focus_score": round(self.focus_score, 3),
        }


@dataclass(frozen=True)
class CountResult:
    path: Path
    digest: str
    width: int
    height: int
    detections: list[SeedDetection]
    dish_center: tuple[float, float]
    dish_radius: float
    execution: ExecutionIdentity
    quality: QualityReport

    @property
    def count(self) -> int:
        return len(self.detections)

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": str(self.path),
            "image": {
                "digest": self.digest,
                "width": self.width,
                "height": self.height,
            },
            "count": self.count,
            "quality": self.quality.to_dict(),
            "dish": {
                "center_x": round(self.dish_center[0], 2),
                "center_y": round(self.dish_center[1], 2),
                "radius": round(self.dish_radius, 2),
            },
            **self.execution.to_dict(),
            "detections": [seed.to_dict() for seed in self.detections],
        }
