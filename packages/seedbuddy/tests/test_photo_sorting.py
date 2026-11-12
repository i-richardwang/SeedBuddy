import json
from pathlib import Path

import cv2
import numpy as np
import pytest
from seedbuddy.cli import main
from seedbuddy.photos.record import confirm, load_record, save_record
from seedbuddy.photos.sorting import Shot, sort_photographs

SIZE = (1800, 1200)
CENTRE = (900.0, 600.0)
RADIUS = 520
BENCH = (25, 25, 25)
BROWN = (40, 80, 140)
CREAM = (170, 230, 245)


def _dish(
    variant: int = 1,
    seeds: int = 40,
    color: tuple[int, int, int] = BROWN,
    scale: float = 1.0,
) -> np.ndarray:
    """A dish seen from above: seeds on the paper, a label on the lid."""
    rng = np.random.default_rng(variant)
    image = np.full((SIZE[1], SIZE[0], 3), BENCH, np.uint8)
    cv2.circle(image, (900, 600), RADIUS, (210, 214, 208), -1)
    cv2.circle(image, (900, 600), RADIUS, (236, 236, 236), 8)
    for _ in range(seeds):
        axes = (
            round(rng.integers(8, 14) * scale),
            round(rng.integers(3, 6) * scale),
        )
        turn = float(rng.uniform(0, 180))
        cv2.ellipse(image, _somewhere(rng, 0.45), axes, turn, 0, 360, color, -1)
    cv2.rectangle(image, (790, 120), (1010, 200), (245, 245, 245), -1)
    cv2.putText(
        image, "LOT 7", (805, 180), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (30, 30, 30), 3
    )
    return image


def _somewhere(rng: np.random.Generator, reach: float) -> tuple[int, int]:
    """A point within ``reach`` dish radii of the centre."""
    angle = rng.uniform(0, 2 * np.pi)
    distance = RADIUS * reach * np.sqrt(rng.uniform())
    return (
        round(CENTRE[0] + distance * np.cos(angle)),
        round(CENTRE[1] + distance * np.sin(angle)),
    )


def _droplets(image: np.ndarray) -> np.ndarray:
    rng = np.random.default_rng(5)
    for _ in range(900):
        radius = int(rng.integers(2, 4))
        cv2.circle(image, _somewhere(rng, 0.55), radius, (248, 248, 248), -1)
    return image


def _shot(dish: np.ndarray, angle: float, shift: tuple[float, float]) -> np.ndarray:
    motion = cv2.getRotationMatrix2D(CENTRE, angle, 1.0)
    motion[:, 2] += shift
    return cv2.warpAffine(dish, motion, SIZE, borderValue=BENCH)


def _defocus_seeds(
    image: np.ndarray, sigma: float, shift: tuple[float, float] = (0, 0)
) -> np.ndarray:
    """Focus on the lid: the seeds blur while the label stays crisp."""
    blurred = cv2.GaussianBlur(image, (0, 0), sigma)
    inside = np.zeros(image.shape[:2], np.uint8)
    centre = (round(CENTRE[0] + shift[0]), round(CENTRE[1] + shift[1]))
    cv2.circle(inside, centre, round(RADIUS * 0.7), 255, -1)
    return np.where(inside[:, :, None] > 0, blurred, image)


def _shots(folder: Path) -> dict[str, Shot]:
    result = sort_photographs(folder, progress=lambda _: None)
    return {shot.path.name: shot for dish in result.dishes for shot in dish.shots}


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    first, second = _dish(variant=1), _dish(variant=2)
    cv2.imwrite(str(tmp_path / "a-sharp.png"), _shot(first, 3.0, (20, -15)))
    cv2.imwrite(
        str(tmp_path / "a-label.png"),
        _defocus_seeds(_shot(first, -4.0, (-30, 10)), 2.5, (-30, 10)),
    )
    cv2.imwrite(str(tmp_path / "b.png"), _shot(second, 1.0, (5, 5)))
    return tmp_path


def test_photographs_of_one_dish_are_grouped_and_the_sharp_seeds_come_first(
    folder: Path,
) -> None:
    result = sort_photographs(folder, progress=lambda _: None)

    assert [[shot.path.name for shot in dish.shots] for dish in result.dishes] == [
        ["a-sharp.png", "a-label.png"],
        ["b.png"],
    ]
    sharp, label = result.dishes[0].shots
    assert sharp.sharpness == 0.0
    assert label.sharpness is not None and label.sharpness < -0.1
    assert result.dishes[1].shots[0].sharpness is None


def test_each_photograph_is_carried_onto_the_first_of_its_dish(folder: Path) -> None:
    sharp, label = sort_photographs(folder, progress=lambda _: None).dishes[0].shots

    assert sharp.alignment == ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    # The dish's centre lies at CENTRE + (-30, 10) in one and CENTRE + (20, -15)
    # in the other.
    carried = np.array(label.alignment) @ [CENTRE[0] - 30, CENTRE[1] + 10, 1.0]
    assert np.hypot(*(carried - [CENTRE[0] + 20, CENTRE[1] - 15])) < 6


def test_sharp_seeds_and_germinated_seeds_can_be_counted(tmp_path: Path) -> None:
    cv2.imwrite(str(tmp_path / "sharp.png"), _dish())
    cv2.imwrite(
        str(tmp_path / "germinated.png"), _dish(seeds=18, color=CREAM, scale=2.2)
    )

    shots = _shots(tmp_path)

    assert shots["sharp.png"].suitable
    assert shots["sharp.png"].reason is None
    assert shots["germinated.png"].suitable


def test_soft_seeds_and_a_droplet_carpet_cannot_be_counted(tmp_path: Path) -> None:
    cv2.imwrite(str(tmp_path / "soft.png"), _defocus_seeds(_dish(), 12.0))
    cv2.imwrite(str(tmp_path / "droplets.png"), _droplets(_dish(seeds=0)))

    shots = _shots(tmp_path)

    assert shots["soft.png"].reason == "seeds are out of focus"
    assert not shots["soft.png"].suitable
    assert shots["droplets.png"].reason == "paper covered by droplets"
    assert not shots["droplets.png"].suitable


def test_files_without_a_dish_are_skipped(tmp_path: Path) -> None:
    (tmp_path / "broken.jpg").write_bytes(b"not an image")
    cv2.imwrite(str(tmp_path / "blank.png"), np.full((600, 900), 90, np.uint8))
    (tmp_path / "notes.txt").write_text("ignored")

    result = sort_photographs(tmp_path, progress=lambda _: None)

    assert result.dishes == ()
    assert sorted((item.path.name, item.reason) for item in result.skipped) == [
        ("blank.png", "no dish found"),
        ("broken.jpg", "unreadable"),
    ]


def test_sort_prints_the_record_and_leaves_the_files(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cv2.imwrite(str(tmp_path / "sharp.png"), _dish())
    before = sorted(path.name for path in tmp_path.iterdir())

    assert main(["photos", "sort", str(tmp_path)]) == 0

    assert json.loads(capsys.readouterr().out) == {
        "dishes": [
            {
                "shots": [
                    {
                        "path": str((tmp_path / "sharp.png").resolve()),
                        "sharpness": None,
                        "suitable": True,
                        "reason": None,
                        "alignment": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
                    }
                ]
            }
        ],
        "skipped": [],
    }
    assert sorted(path.name for path in tmp_path.iterdir()) == before


def test_sort_writes_the_record_it_prints_until_a_person_has_confirmed(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    folder = tmp_path / "plates"
    folder.mkdir()
    cv2.imwrite(str(folder / "sharp.png"), _dish())
    output = tmp_path / "plates.json"

    for _ in range(2):
        assert main(["photos", "sort", str(folder), "-o", str(output)]) == 0
        assert output.read_text(encoding="utf-8") == capsys.readouterr().out

    record = load_record(output)
    confirm(record, dish=0, shot=0, suitable=True, note="")
    save_record(output, record)
    confirmed = output.read_text(encoding="utf-8")

    assert main(["photos", "sort", str(folder), "-o", str(output)]) == 2

    error = capsys.readouterr().err
    assert "already holds confirmations" in error
    assert "Surveying" not in error
    assert output.read_text(encoding="utf-8") == confirmed


def test_sort_refuses_a_missing_folder(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["photos", "sort", str(tmp_path / "absent")]) == 2
    assert "is not a folder" in capsys.readouterr().err
