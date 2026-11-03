from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import PARAMETERS

from vitroctl.training.recipe import TrainingRecipe


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
def test_project_recipe_files_obey_the_training_recipe_contract(path: Path) -> None:
    document = json.loads(path.read_text())
    parsed = TrainingRecipe.from_document(document, str(path))
    assert parsed.base_model_reference == document["baseModel"]["reference"]
    assert parsed.base_model_digest == document["baseModel"]["digest"]
    assert parsed.parameters == document["parameters"]
    assert parsed.runtime_version == document["runtime"]["version"]


def test_training_parameters_accept_the_shared_recipe(recipe) -> None:
    parameters = dict(recipe["parameters"])

    assert (
        TrainingRecipe.from_document({**recipe, "parameters": parameters}).parameters
        == parameters
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("epochs", 0),
        ("patience", 301),
        ("batch", True),
        ("nbs", 0),
        ("nbs", True),
        ("nbs", 1.5),
        ("nbs", 1025),
        ("imgsz", 769),
        ("optimizer", "Other"),
        ("lr0", float("nan")),
        ("warmup_epochs", 11),
        ("mosaic", -0.1),
        ("mixup", 1.1),
        ("copy_paste", "0"),
        ("max_det", 0),
        ("seed", -1),
        ("deterministic", 1),
    ],
)
def test_training_parameters_reject_invalid_values(
    field: str, value: object, recipe
) -> None:
    parameters = dict(recipe["parameters"])
    parameters[field] = value

    with pytest.raises((TypeError, ValueError), match=field):
        TrainingRecipe.from_document({**recipe, "parameters": parameters})


def test_training_parameters_require_the_exact_field_set(recipe) -> None:
    parameters = dict(recipe["parameters"])
    parameters.pop("epochs")

    with pytest.raises(ValueError, match="epochs"):
        TrainingRecipe.from_document({**recipe, "parameters": parameters})

    parameters = dict(recipe["parameters"])
    parameters["augment"] = 1
    with pytest.raises(ValueError, match="augment"):
        TrainingRecipe.from_document({**recipe, "parameters": parameters})


def test_omitted_nominal_batch_retains_runtime_semantics(recipe) -> None:
    parameters = dict(recipe["parameters"])
    parameters.pop("nbs")
    assert (
        "nbs"
        not in TrainingRecipe.from_document(
            {**recipe, "parameters": parameters}
        ).parameters
    )
    assert (
        TrainingRecipe.from_document(
            {**recipe, "parameters": {**parameters, "nbs": 8}}
        ).parameters["nbs"]
        == 8
    )
