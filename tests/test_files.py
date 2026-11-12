from pathlib import Path

import pytest

from seedctl.io.files import atomic_directory, atomic_file, write_text_atomically


def test_atomic_directory_publishes_complete_content(tmp_path: Path) -> None:
    destination = tmp_path / "artifact"

    with atomic_directory(destination) as working:
        (working / "result.json").write_text("{}\n", encoding="utf-8")
        assert not destination.exists()

    assert (destination / "result.json").read_text(encoding="utf-8") == "{}\n"


def test_atomic_directory_discards_failed_work(tmp_path: Path) -> None:
    destination = tmp_path / "artifact"

    with (
        pytest.raises(RuntimeError, match="failed"),
        atomic_directory(destination) as working,
    ):
        (working / "partial.json").write_text("{}", encoding="utf-8")
        raise RuntimeError("failed")

    assert not destination.exists()
    assert not list(tmp_path.glob(".artifact-*"))


def test_atomic_directory_requires_a_new_destination(tmp_path: Path) -> None:
    destination = tmp_path / "artifact"
    destination.mkdir()

    with (
        pytest.raises(FileExistsError, match="already exists"),
        atomic_directory(destination),
    ):
        pass


def test_atomic_file_publishes_complete_content(tmp_path: Path) -> None:
    destination = tmp_path / "nested" / "blob"

    with atomic_file(destination) as handle:
        handle.write(b"payload")
        assert not destination.exists()

    assert destination.read_bytes() == b"payload"
    assert [child.name for child in destination.parent.iterdir()] == ["blob"]


def test_atomic_file_discards_failed_work(tmp_path: Path) -> None:
    destination = tmp_path / "blob"
    destination.write_bytes(b"previous")

    with (
        pytest.raises(RuntimeError, match="failed"),
        atomic_file(destination) as handle,
    ):
        handle.write(b"partial")
        raise RuntimeError("failed")

    assert destination.read_bytes() == b"previous"
    assert [child.name for child in tmp_path.iterdir()] == ["blob"]


def test_write_text_atomically_replaces_the_previous_file(tmp_path: Path) -> None:
    destination = tmp_path / "document.json"
    destination.write_text("previous", encoding="utf-8")

    write_text_atomically(destination, "current\n")

    assert destination.read_text(encoding="utf-8") == "current\n"
