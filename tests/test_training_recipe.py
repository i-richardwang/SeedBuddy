from __future__ import annotations

from pathlib import Path

import pytest
from conftest import PARAMETERS

from vitroctl.training.recipe import (
    parse_training_recipe,
)


def _recipe() -> dict[str, object]:
    return {
        "baseModel": {"reference": "yolo26n.pt", "digest": "a" * 64},
        "parameters": PARAMETERS,
        "runtime": {"framework": "ultralytics", "version": "8.4.131"},
    }


def test_training_recipe_parser_returns_the_complete_identity() -> None:
    recipe = parse_training_recipe(_recipe())

    assert recipe.base_model_reference == "yolo26n.pt"
    assert recipe.base_model_digest == "a" * 64
    assert recipe.parameters["epochs"] == 3
    assert recipe.runtime_version == "8.4.131"


def test_training_recipe_requires_the_ultralytics_runtime() -> None:
    recipe = _recipe()
    recipe["runtime"] = {"framework": "other", "version": "1.0"}

    with pytest.raises(ValueError):
        parse_training_recipe(recipe)


@pytest.mark.parametrize(
    "recipe",
    sorted(
        path.name
        for path in (Path(__file__).parents[1] / "configs/yolo26").glob("*.recipe.json")
    ),
    indirect=True,
)
def test_project_recipes_parse_with_the_generated_schema(recipe) -> None:
    parsed = parse_training_recipe(recipe)
    assert parsed.base_model_reference == recipe["baseModel"]["reference"]
    assert parsed.base_model_digest == recipe["baseModel"]["digest"]
    assert parsed.parameters == recipe["parameters"]
    assert parsed.runtime_version == recipe["runtime"]["version"]
