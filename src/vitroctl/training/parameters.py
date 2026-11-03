"""Decode parameters using the shared training contract."""

from __future__ import annotations

from typing import Any

from vitroctl.contracts.validation import validate_wire_contract


def parse_training_parameters(
    value: Any, context: str = "training parameters"
) -> dict[str, Any]:
    validate_wire_contract("training-parameters", value, context)
    return dict(value)
