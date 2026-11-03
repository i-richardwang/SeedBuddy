from __future__ import annotations

import pytest

from vitroctl.training.parameters import parse_training_parameters


def test_training_parameters_accept_the_shared_recipe(recipe) -> None:
    parameters = dict(recipe["parameters"])

    assert parse_training_parameters(parameters) == parameters


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
        parse_training_parameters(parameters)


def test_training_parameters_require_the_exact_field_set(recipe) -> None:
    parameters = dict(recipe["parameters"])
    parameters.pop("epochs")

    with pytest.raises(ValueError, match="epochs"):
        parse_training_parameters(parameters)

    parameters = dict(recipe["parameters"])
    parameters["augment"] = 1
    with pytest.raises(ValueError, match="augment"):
        parse_training_parameters(parameters)


def test_omitted_nominal_batch_retains_runtime_semantics(recipe) -> None:
    parameters = dict(recipe["parameters"])
    parameters.pop("nbs")
    assert "nbs" not in parse_training_parameters(parameters)
    assert parse_training_parameters({**parameters, "nbs": 8})["nbs"] == 8
