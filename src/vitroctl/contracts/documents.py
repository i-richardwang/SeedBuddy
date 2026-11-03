"""Validate protocol envelopes without generated schemas."""

from __future__ import annotations

from typing import Any


def as_object(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise TypeError(f"{context} must be an object")
    return value


def expect_fields(
    value: dict[str, Any],
    required: set[str],
    context: str,
) -> None:
    missing = required - set(value)
    extra = set(value) - required
    if missing or extra:
        details = []
        if missing:
            details.append(f"missing {', '.join(sorted(missing))}")
        if extra:
            details.append(f"unknown {', '.join(sorted(extra))}")
        raise ValueError(f"{context} fields are invalid: {'; '.join(details)}")
