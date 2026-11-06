from pathlib import Path

import pytest
from conftest import (
    SEED_CLASSES,
    annotation_document,
    encoded_image,
    manifest_entry,
    write_blob,
    write_manifest,
)

from vitroctl.datasets.manifest import load_dataset_manifest
from vitroctl.detectors.ultralytics import export_yolo_dataset

ultralytics = pytest.importorskip("ultralytics")


@pytest.mark.parametrize(
    "recipe",
    ["yolo26n-whole-v1.recipe.json", "yolo26s-whole-2048-v1.recipe.json"],
    indirect=True,
)
def test_seed_recipe_parameters_are_accepted_ultralytics_arguments(recipe) -> None:
    from ultralytics.cfg import get_cfg

    parameters = recipe["parameters"]

    cfg = get_cfg(overrides=dict(parameters))

    for name, value in parameters.items():
        assert getattr(cfg, name) == value


def test_yolo_resolves_exported_dataset_from_its_yaml(
    tmp_path: Path, monkeypatch
) -> None:
    from ultralytics.data import utils as data_utils

    monkeypatch.setattr(data_utils, "check_font", lambda *_args, **_kwargs: None)

    data_root = tmp_path / "data"
    entries = []
    for variant in range(2):
        digest = write_blob(data_root, encoded_image(variant=variant))
        entries.append(manifest_entry(digest, annotation=annotation_document(digest)))
    annotated = load_dataset_manifest(
        write_manifest(data_root, "batch", entries)
    ).annotated

    output = tmp_path / "dataset"
    export_yolo_dataset(annotated, SEED_CLASSES, data_root, output, mode="whole_image")

    loaded = data_utils.check_det_dataset(str((output / "dataset.yaml").resolve()))

    assert Path(loaded["train"]) == (output / "images" / "train").resolve()
    assert Path(loaded["val"]) == (output / "images" / "val").resolve()
