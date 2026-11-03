from __future__ import annotations

import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Any, TypeVar


@dataclass(frozen=True)
class GeometryConfig:
    reference_radius_fraction: float = 0.60
    search_radius_fraction: float = 0.90

    def __post_init__(self) -> None:
        if not 0 < self.reference_radius_fraction <= self.search_radius_fraction <= 1:
            raise ValueError("Geometry radii must satisfy 0 < reference <= search <= 1")


@dataclass(frozen=True)
class ProposalConfig:
    minimum_scale_fraction: float = 0.0025
    maximum_scale_fraction: float = 0.0080
    scale_levels: int = 6

    def __post_init__(self) -> None:
        if not 0 < self.minimum_scale_fraction <= self.maximum_scale_fraction:
            raise ValueError("Proposal scales must be positive and ordered")
        if self.scale_levels < 2:
            raise ValueError("Proposal scale_levels must be at least 2")


@dataclass(frozen=True)
class DecisionConfig:
    confidence_threshold: float = 0.889313
    duplicate_distance_scale: float = 1.5

    def __post_init__(self) -> None:
        if not 0 <= self.confidence_threshold <= 1:
            raise ValueError("Decision confidence_threshold must be between 0 and 1")
        if self.duplicate_distance_scale <= 0:
            raise ValueError("Decision duplicate_distance_scale must be positive")


@dataclass(frozen=True)
class RenderingConfig:
    region_radius_fraction: float = 0.020

    def __post_init__(self) -> None:
        if self.region_radius_fraction <= 0:
            raise ValueError("Rendering region_radius_fraction must be positive")


@dataclass(frozen=True)
class QualityConfig:
    maximum_clipped_fraction: float = 0.02
    minimum_focus_score: float = 12.0

    def __post_init__(self) -> None:
        if not 0 <= self.maximum_clipped_fraction <= 1:
            raise ValueError("Quality maximum_clipped_fraction must be between 0 and 1")
        if self.minimum_focus_score < 0:
            raise ValueError("Quality minimum_focus_score cannot be negative")


@dataclass(frozen=True)
class PipelineConfig:
    geometry: GeometryConfig = GeometryConfig()
    proposals: ProposalConfig = ProposalConfig()
    decision: DecisionConfig = DecisionConfig()
    rendering: RenderingConfig = RenderingConfig()
    quality: QualityConfig = QualityConfig()

    @classmethod
    def from_json(cls, path: str | Path) -> PipelineConfig:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Configuration must be a JSON object")
        valid_sections = {field.name for field in fields(cls)}
        unknown_sections = set(data).difference(valid_sections)
        if unknown_sections:
            names = ", ".join(sorted(unknown_sections))
            raise ValueError(f"Unknown configuration section(s): {names}")
        return cls(
            geometry=_section(GeometryConfig, data, "geometry"),
            proposals=_section(ProposalConfig, data, "proposals"),
            decision=_section(DecisionConfig, data, "decision"),
            rendering=_section(RenderingConfig, data, "rendering"),
            quality=_section(QualityConfig, data, "quality"),
        )

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


ConfigSection = TypeVar(
    "ConfigSection",
    GeometryConfig,
    ProposalConfig,
    DecisionConfig,
    RenderingConfig,
    QualityConfig,
)


def _section(
    section_type: type[ConfigSection], data: dict[str, Any], name: str
) -> ConfigSection:
    values = data.get(name, {})
    if not isinstance(values, dict):
        raise ValueError(f"Configuration section '{name}' must be an object")
    valid_fields = {field.name for field in fields(section_type)}
    unknown_fields = set(values).difference(valid_fields)
    if unknown_fields:
        names = ", ".join(sorted(unknown_fields))
        raise ValueError(f"Unknown field(s) in '{name}': {names}")
    try:
        return section_type(**values)
    except TypeError as error:
        raise ValueError(f"Invalid configuration section {name}: {error}") from error


DEFAULT_PIPELINE_CONFIG = PipelineConfig()
