import json
from pathlib import Path

import pytest

from seedctl.detectors.traditional.config import PipelineConfig


def test_config_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(
        json.dumps(
            {
                "geometry": {"search_radius_fraction": 0.85},
                "decision": {"confidence_threshold": 0.9},
            }
        ),
        encoding="utf-8",
    )

    config = PipelineConfig.from_json(path)

    assert config.geometry.search_radius_fraction == 0.85
    assert config.decision.confidence_threshold == 0.9
    assert config.proposals == PipelineConfig().proposals


@pytest.mark.parametrize(
    "payload, expected",
    [
        ({"mystery": {}}, "mystery"),
        ({"geometry": {"mystery": 1}}, "mystery"),
        ({"geometry": 1}, "geometry"),
    ],
)
def test_config_rejects_unknown_or_malformed_fields(
    tmp_path: Path, payload: object, expected: str
) -> None:
    path = tmp_path / "config.json"
    path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises((TypeError, ValueError), match=expected):
        PipelineConfig.from_json(path)
