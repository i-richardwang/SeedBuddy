import json
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import cv2
import numpy as np
import pytest
from seedbuddy.cli import main
from seedbuddy.photos.record import load_record
from seedbuddy.photos.review import ReviewServer, bind_review

IN_PLACE = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]


def _image(folder: Path, name: str) -> str:
    path = folder / name
    cv2.imwrite(str(path), np.full((24, 32, 3), (40, 80, 120), np.uint8))
    return str(path)


def _shot(path: str, sharpness: float | None, reason: str | None) -> dict:
    return {
        "path": path,
        "sharpness": sharpness,
        "suitable": reason is None,
        "reason": reason,
        "alignment": IN_PLACE,
    }


def _record(folder: Path) -> Path:
    """Three dishes: a clear win that is soft, a close call, and a single shot."""
    record = {
        "dishes": [
            {
                "shots": [
                    _shot(_image(folder, "soft.png"), 0.0, "seeds are out of focus"),
                    _shot(_image(folder, "softer.png"), -0.4, "seeds are out of focus"),
                ]
            },
            {
                "shots": [
                    _shot(_image(folder, "close.png"), 0.0, None),
                    _shot(_image(folder, "rival.png"), -0.05, None),
                ]
            },
            {"shots": [_shot(_image(folder, "single.png"), None, None)]},
        ],
        "skipped": [],
    }
    path = folder / "plates.json"
    path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return path


def _open(
    url: str, body: dict | None = None, headers: dict[str, str] | None = None
) -> tuple[int, bytes]:
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, headers=headers or {})
    if data is not None:
        request.add_header("Content-Type", "application/json")
    last: Exception | None = None
    for _ in range(50):
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()
        except urllib.error.URLError as error:
            last = error
            threading.Event().wait(0.02)
    raise AssertionError(last)


@pytest.fixture
def review(tmp_path: Path) -> Iterator[tuple[ReviewServer, str]]:
    server = bind_review(_record(tmp_path))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server, server.origin
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_the_page_shows_each_dish_without_its_paths(
    review: tuple[ReviewServer, str],
) -> None:
    _, origin = review

    page, html = _open(f"{origin}/")
    assert page == 200
    assert b"Accept remaining suggestions" in html
    assert _open(f"{origin}/review.css")[0] == 200
    assert _open(f"{origin}/review.js")[0] == 200

    status, body = _open(f"{origin}/api/review")
    assert status == 200
    view = json.loads(body)
    assert [[shot["name"] for shot in dish["shots"]] for dish in view["dishes"]] == [
        ["soft.png", "softer.png"],
        ["close.png", "rival.png"],
        ["single.png"],
    ]
    assert [dish["doubtful"] for dish in view["dishes"]] == [True, True, False]
    assert all(dish["decision"] is None for dish in view["dishes"])
    assert "path" not in view["dishes"][0]["shots"][0]

    photo, image = _open(f"{origin}/photo/1/1")
    assert photo == 200
    assert image.startswith(b"\x89PNG")
    thumb, small = _open(f"{origin}/thumb/0/0")
    assert thumb == 200
    assert small.startswith(b"\xff\xd8")
    assert _open(f"{origin}/photo/2/1")[0] == 404
    assert _open(f"{origin}/photo/9/0")[0] == 404
    assert _open(f"{origin}/photo/../plates.json")[0] == 404


def test_another_photograph_is_chosen_and_the_rest_are_accepted(
    tmp_path: Path, review: tuple[ReviewServer, str]
) -> None:
    server, origin = review
    before = {item.name: item.read_bytes() for item in tmp_path.glob("*.png")}

    status, body = _open(
        f"{origin}/api/dishes/1",
        {"shot": 1, "suitable": True, "note": " label is out of the way "},
    )
    assert status == 200
    assert json.loads(body)["dishes"][1]["decision"] == {
        "shot": 1,
        "suitable": True,
        "note": "label is out of the way",
    }

    assert _open(f"{origin}/api/accept-remaining", {})[0] == 200

    saved = json.loads(server.record_path.read_text(encoding="utf-8"))
    assert [dish["decision"] for dish in saved["dishes"]] == [
        {"chosen": str(tmp_path / "soft.png"), "suitable": False, "note": ""},
        {
            "chosen": str(tmp_path / "rival.png"),
            "suitable": True,
            "note": "label is out of the way",
        },
        {"chosen": str(tmp_path / "single.png"), "suitable": True, "note": ""},
    ]
    assert saved["dishes"][0]["shots"][0]["reason"] == "seeds are out of focus"
    assert {item.name: item.read_bytes() for item in tmp_path.glob("*.png")} == before


def test_a_confirmation_can_be_taken_back(review: tuple[ReviewServer, str]) -> None:
    server, origin = review
    before = server.record_path.read_text(encoding="utf-8")

    assert _open(f"{origin}/api/dishes/2", {"shot": 0, "suitable": None})[0] == 200
    assert load_record(server.record_path)["dishes"][2]["decision"] == {
        "chosen": load_record(server.record_path)["dishes"][2]["shots"][0]["path"],
        "suitable": None,
        "note": "",
    }

    assert _open(f"{origin}/api/dishes/2", {"clear": True})[0] == 200
    assert server.record_path.read_text(encoding="utf-8") == before


def test_a_confirmation_names_a_photograph_of_the_dish(
    review: tuple[ReviewServer, str],
) -> None:
    server, origin = review
    before = server.record_path.read_text(encoding="utf-8")

    assert _open(f"{origin}/api/dishes/2", {"shot": 1, "suitable": True})[0] == 400
    assert _open(f"{origin}/api/dishes/0", {"shot": 0, "suitable": "yes"})[0] == 400
    assert _open(f"{origin}/api/dishes/0", {"suitable": True})[0] == 400
    assert _open(f"{origin}/api/dishes/9", {"shot": 0, "suitable": True})[0] == 404
    assert server.record_path.read_text(encoding="utf-8") == before


def test_only_the_page_itself_is_answered(review: tuple[ReviewServer, str]) -> None:
    server, origin = review
    before = server.record_path.read_text(encoding="utf-8")
    elsewhere = "http://elsewhere.example"

    assert _open(f"{origin}/photo/0/0", headers={"Host": "elsewhere.example"})[0] == 403
    assert _open(f"{origin}/api/accept-remaining", {}, {"Origin": elsewhere})[0] == 403
    assert server.record_path.read_text(encoding="utf-8") == before

    assert _open(f"{origin}/api/accept-remaining", {}, {"Origin": origin})[0] == 200


def test_a_record_names_photographs_only(tmp_path: Path) -> None:
    path = _record(tmp_path)
    record = json.loads(path.read_text(encoding="utf-8"))
    record["dishes"][0]["shots"][0]["path"] = str(path)
    path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(ValueError, match="is not a record of sorted photographs"):
        load_record(path)


def test_review_refuses_a_missing_file(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["photos", "review", str(tmp_path / "missing.json")]) == 2
    assert "is not a file" in capsys.readouterr().err
