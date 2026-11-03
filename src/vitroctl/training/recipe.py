"""The canonical YOLO training recipe contract."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from vitroctl.contracts.validation import validate_wire_contract


@dataclass(frozen=True)
class TrainingRecipe:
    """A validated training identity carried by every run and model version."""

    base_model_reference: str
    base_model_digest: str
    parameters: dict[str, Any]
    runtime_version: str

    @classmethod
    def from_document(cls, value: dict[str, Any]) -> TrainingRecipe:
        """Read the recipe fields from a schema-validated document."""
        return cls(
            base_model_reference=value["baseModel"]["reference"],
            base_model_digest=value["baseModel"]["digest"],
            parameters=value["parameters"],
            runtime_version=value["runtime"]["version"],
        )


def parse_training_recipe(value: Any, context: str = "recipe") -> TrainingRecipe:
    validate_wire_contract("training-recipe", value, context)
    return TrainingRecipe.from_document(value)
