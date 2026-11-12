"""The record of a sorted folder: each dish's photographs, and what a person confirmed.

Sorting suggests the first photograph of a dish and says whether its seeds can
be counted. A person's confirmation is kept beside that suggestion as the
dish's ``decision``, which names the photograph to use and whether it can be
counted.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from seedbuddy.photos.photographs import PHOTO_SUFFIXES
from seedbuddy.photos.sorting import Sorted


def record_of(result: Sorted) -> dict:
    return {
        "dishes": [
            {
                "shots": [
                    {
                        "path": str(shot.path),
                        "sharpness": None
                        if shot.sharpness is None
                        else round(shot.sharpness, 3),
                        "suitable": shot.suitable,
                        "reason": shot.reason,
                        "alignment": [
                            [round(value, 5) for value in row] for row in shot.alignment
                        ],
                    }
                    for shot in dish.shots
                ],
            }
            for dish in result.dishes
        ],
        "skipped": [
            {"path": str(item.path), "reason": item.reason} for item in result.skipped
        ],
    }


def load_record(path: Path) -> dict:
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{path} is not a record of sorted photographs") from error
    if not _is_record(record):
        raise ValueError(f"{path} is not a record of sorted photographs")
    return record


def save_record(path: Path, record: dict) -> None:
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}-")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def has_confirmations(record: dict) -> bool:
    return any(dish.get("decision") is not None for dish in record["dishes"])


def confirm(
    record: dict, dish: int, shot: int, suitable: bool | None, note: str
) -> None:
    """Use one photograph of a dish, and say whether its seeds can be counted."""
    entry = record["dishes"][dish]
    entry["decision"] = _decision(entry["shots"][shot], suitable, note)


def clear_confirmation(record: dict, dish: int) -> None:
    record["dishes"][dish].pop("decision", None)


def accept_remaining(record: dict) -> None:
    """Confirm the suggestion for every dish that has no confirmation yet."""
    for dish in record["dishes"]:
        if dish.get("decision") is not None:
            continue
        suggested = dish["shots"][0]
        dish["decision"] = _decision(suggested, suggested["suitable"], "")


def is_verdict(value: object) -> bool:
    """Whether a value says the seeds can be counted, cannot, or left unsure."""
    return value is True or value is False or value is None


def _decision(shot: dict, suitable: bool | None, note: str) -> dict:
    return {"chosen": shot["path"], "suitable": suitable, "note": note}


def _is_record(record: object) -> bool:
    if not isinstance(record, dict):
        return False
    dishes, skipped = record.get("dishes"), record.get("skipped")
    return (
        isinstance(dishes, list)
        and all(_is_dish(dish) for dish in dishes)
        and isinstance(skipped, list)
        and all(_is_skipped(item) for item in skipped)
    )


def _is_dish(dish: object) -> bool:
    if not isinstance(dish, dict):
        return False
    shots = dish.get("shots")
    if not isinstance(shots, list) or not shots:
        return False
    if not all(_is_shot(shot) for shot in shots):
        return False
    return _is_decision(dish.get("decision"), {shot["path"] for shot in shots})


def _is_shot(shot: object) -> bool:
    if not isinstance(shot, dict):
        return False
    sharpness, reason = shot.get("sharpness"), shot.get("reason")
    return (
        _is_photograph(shot.get("path"))
        and (sharpness is None or _is_number(sharpness))
        and isinstance(shot.get("suitable"), bool)
        and (reason is None or isinstance(reason, str))
        and _is_alignment(shot.get("alignment"))
    )


def _is_photograph(path: object) -> bool:
    return isinstance(path, str) and Path(path).suffix.lower() in PHOTO_SUFFIXES


def _is_alignment(alignment: object) -> bool:
    return (
        isinstance(alignment, list)
        and len(alignment) == 2
        and all(
            isinstance(row, list)
            and len(row) == 3
            and all(_is_number(value) for value in row)
            for row in alignment
        )
    )


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_decision(decision: object, paths: set[str]) -> bool:
    if decision is None:
        return True
    if not isinstance(decision, dict):
        return False
    return (
        decision.get("chosen") in paths
        and is_verdict(decision.get("suitable"))
        and isinstance(decision.get("note"), str)
    )


def _is_skipped(item: object) -> bool:
    return (
        isinstance(item, dict)
        and isinstance(item.get("path"), str)
        and isinstance(item.get("reason"), str)
    )
