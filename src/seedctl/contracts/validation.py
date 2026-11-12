"""Validation against wire schemas generated from the Web Zod contracts."""

from __future__ import annotations

import json
import math
from functools import cache
from importlib.resources import files
from typing import Any

from jsonschema import Draft202012Validator


@cache
def _validator(name: str) -> Draft202012Validator:
    resource = files("seedctl.contracts").joinpath(f"{name}.schema.json")
    schema = json.loads(resource.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def validate_wire_contract(name: str, value: Any, context: str) -> None:
    """Validate wire structure before decoding domain semantics."""

    # JSON has no NaN or infinities, even when a Python caller bypasses decoding.
    def finite(item: Any, location: str) -> None:
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError(f"{location} must be finite")
        if isinstance(item, dict):
            for key, child in item.items():
                finite(child, f"{location}.{key}")
        elif isinstance(item, list):
            for index, child in enumerate(item):
                finite(child, f"{location}[{index}]")

    finite(value, context)
    errors = sorted(
        _validator(name).iter_errors(value),
        key=lambda error: tuple(str(part) for part in error.absolute_path),
    )
    if not errors:
        return
    error = errors[0]
    suffix = "".join(
        f"[{part}]" if isinstance(part, int) else f".{part}"
        for part in error.absolute_path
    )
    raise ValueError(f"{context}{suffix} violates the shared contract: {error.message}")


def outbound(name: str, document: dict[str, Any]) -> dict[str, Any]:
    """Validate at the send boundary, using the schema name as the error context."""
    validate_wire_contract(name, document, name)
    return document
