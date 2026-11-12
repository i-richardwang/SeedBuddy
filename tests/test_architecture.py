from __future__ import annotations

import importlib.util
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "architecture",
    Path(__file__).resolve().parents[1] / "scripts/check_architecture.py",
)
assert SPEC and SPEC.loader
architecture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(architecture)


def test_contracts_cannot_depend_on_worker_or_algorithm_runtime() -> None:
    errors = architecture.check_architecture(
        {
            "seedctl.contracts.validation": "from seedctl.worker.service import Worker\nimport torch",
            "seedctl.worker.service": "",
        }
    )
    assert any("direction" in error for error in errors)
    assert any("runtime torch" in error for error in errors)


def test_local_and_type_only_cycles_are_checked() -> None:
    errors = architecture.check_architecture(
        {
            "seedctl.training.recipe": "from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n from .parameters import Parameters",
            "seedctl.training.parameters": "def parse():\n from .recipe import Recipe",
        }
    )
    assert any("Dependency cycle" in error for error in errors)


def test_package_dependency_direction_is_checked_without_a_file_cycle() -> None:
    errors = architecture.check_architecture(
        {
            "seedctl.contracts.annotation": "from seedctl.datasets.manifest import Manifest",
            "seedctl.datasets.manifest": "from seedctl.contracts.annotation import Annotation",
        }
    )
    assert any("direction" in error for error in errors)
    assert any("Dependency cycle" in error for error in errors)


def test_package_member_imports_participate_in_cycles() -> None:
    errors = architecture.check_architecture(
        {
            "seedctl.training": "",
            "seedctl.training.recipe": "from seedctl.training import parameters",
            "seedctl.training.parameters": "from . import recipe",
        },
        {"seedctl.training"},
    )
    assert any("Dependency cycle" in error for error in errors)


def test_detector_contracts_have_only_their_designated_importers() -> None:
    for layer in ("training", "image_geometry", "models", "worker.host", "cli"):
        errors = architecture.check_architecture(
            {
                f"seedctl.{layer}.consumer": "from seedctl.detectors.contract import DetectionResult",
                "seedctl.detectors.contract": "",
            }
        )
        assert any("direction" in error for error in errors)
    for layer in (
        "datasets",
        "detectors.traditional",
        "detectors.ultralytics",
        "worker",
    ):
        assert not architecture.check_architecture(
            {
                f"seedctl.{layer}.consumer": "from seedctl.detectors.contract import DetectionResult",
                "seedctl.detectors.contract": "",
            }
        )
