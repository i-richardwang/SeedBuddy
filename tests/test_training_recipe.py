from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import PARAMETERS

from vitroctl.training.recipe import (
    TrainingRecipe,
)


def _recipe() -> dict[str, object]:
    return {
        "baseModel": {"reference": "yolo26n.pt", "digest": "a" * 64},
        "parameters": PARAMETERS,
        "runtime": {"framework": "ultralytics", "version": "8.4.131"},
    }


def test_training_recipe_parser_returns_the_complete_identity() -> None:
    recipe = TrainingRecipe.from_document(_recipe())

    assert recipe.base_model_reference == "yolo26n.pt"
    assert recipe.base_model_digest == "a" * 64
    assert recipe.parameters["epochs"] == 3
    assert recipe.runtime_version == "8.4.131"


def test_training_recipe_requires_the_ultralytics_runtime() -> None:
    recipe = _recipe()
    recipe["runtime"] = {"framework": "other", "version": "1.0"}

    with pytest.raises(ValueError, match="recipe.runtime.framework.*ultralytics"):
        TrainingRecipe.from_document(recipe)


@pytest.mark.parametrize(
    "path",
    sorted((Path(__file__).parents[1] / "configs/yolo26").glob("*.recipe.json")),
)
def test_project_recipe_files_obey_the_workbench_manifest_contract(path: Path) -> None:
    document = json.loads(path.read_text())
    assert set(document) == {"schemaVersion", "recipe"}
    assert type(document["schemaVersion"]) is int and document["schemaVersion"] == 1
    recipe = document["recipe"]
    parsed = TrainingRecipe.from_document(recipe, str(path))
    assert parsed.base_model_reference == recipe["baseModel"]["reference"]
    assert parsed.base_model_digest == recipe["baseModel"]["digest"]
    assert parsed.parameters == recipe["parameters"]
    assert parsed.runtime_version == recipe["runtime"]["version"]
