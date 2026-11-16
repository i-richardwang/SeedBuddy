from __future__ import annotations

import base64
from pathlib import Path

import pytest
from PIL import Image

from seedctl.io.image_io import CANONICAL_EXTENSION, image_shape, read_image

# A 16 by 16 picture in the canonical encoding: red on the left, blue on the right.
_PICTURE = base64.b64decode(
    "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAA"
    "AAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEA"
    "AAETAAAARwAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAA"
    "AEtpcGNvAAAAFGlzcGUAAAAAAAAAEAAAABAAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAA"
    "E2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAT21kYXQSAAoGGAz/2BCA"
    "MjsRgAAAQDlcovweLPQqW6opLO6rD+jbVMSi+zBtdp+48xosSa71ppmDYQr/hYV57+u9rEI1filL"
    "pXRqOA=="
)


def test_a_stored_image_is_read_wherever_a_worker_runs(tmp_path: Path) -> None:
    source = tmp_path / f"picture{CANONICAL_EXTENSION}"
    source.write_bytes(_PICTURE)

    image = read_image(source)

    assert image.shape == (16, 16, 3)
    blue, green, red = image[8, 2]
    assert (blue, green) == (0, 0) and red > 250
    blue, green, red = image[8, 13]
    assert (green, red) == (0, 0) and blue > 250


def test_the_shape_of_a_stored_image_is_what_its_pixels_have(tmp_path: Path) -> None:
    source = tmp_path / f"wide{CANONICAL_EXTENSION}"
    Image.new("RGB", (30, 20)).save(source)

    assert image_shape(source) == read_image(source).shape[:2] == (20, 30)


def test_a_file_that_is_not_an_image_is_refused(tmp_path: Path) -> None:
    source = tmp_path / "notes.avif"
    source.write_text("not a picture")

    with pytest.raises(ValueError, match="Unable to read image: notes.avif"):
        read_image(source)
