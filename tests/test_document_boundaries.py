"""Document boundaries validate structure once, including all nested documents."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from vitroctl.contracts import validation
from vitroctl.datasets.manifest import DatasetManifest
from vitroctl.training.documents import TrainingClaim, TrainingSnapshot
from vitroctl.training.recipe import TrainingRecipe
from vitroctl.worker.inference_protocol import Assignment

FIXTURES = Path(__file__).parent / "fixtures/contracts"


def _fixture(name: str):
    return json.loads((FIXTURES / name).read_text())


@pytest.mark.parametrize(
    "kind, decode, document",
    [
        (
            "training-run",
            TrainingClaim.from_document,
            _fixture("training-claim.json")["run"],
        ),
        (
            "training-recipe",
            TrainingRecipe.from_document,
            _fixture("training-claim.json")["run"]["recipe"],
        ),
        (
            "inference-assignment",
            Assignment.from_document,
            _fixture("inference-assignment-yolo.json"),
        ),
        (
            "dataset-manifest",
            DatasetManifest.from_document,
            _fixture("dataset-manifest.json"),
        ),
        (
            "training-snapshot",
            TrainingSnapshot.from_document,
            {
                "schemaVersion": 1,
                "id": "snapshot-one",
                "datasetId": "dataset-one",
                "modelId": "model-one",
                "createdAt": "2026-08-27T00:00:00.000Z",
                "classes": ["seed"],
                "images": [
                    {
                        **_fixture("annotation.json")["image"],
                        "digest": digest,
                        "split": split,
                        "annotation": {
                            **_fixture("annotation.json"),
                            "image": {
                                **_fixture("annotation.json")["image"],
                                "digest": digest,
                            },
                        },
                    }
                    for digest, split in [("c" * 64, "train"), ("d" * 64, "val")]
                ],
            },
        ),
    ],
)
def test_external_document_validates_only_its_enclosing_schema(
    monkeypatch, kind, decode, document
):
    checked = []
    validator = validation._validator

    def track(name):
        checked.append(name)
        return validator(name)

    monkeypatch.setattr(validation, "_validator", track)
    decode(document)
    assert checked == [kind]


@pytest.mark.parametrize("field", ["annotation", "detection"])
def test_manifest_semantic_errors_preserve_nested_caller_context(field):
    document = _fixture("dataset-manifest.json")
    document["images"][0][field]["instances"][0]["bbox"]["x"] = 99
    with pytest.raises(ValueError) as error:
        DatasetManifest.from_document(document, "downloaded batch")
    assert str(error.value) == (
        f"downloaded batch.images[0].{field}.instances[0].bbox exceeds image bounds"
    )


def test_snapshot_semantic_errors_preserve_nested_caller_context():
    annotation = _fixture("annotation.json")
    annotation["instances"] *= 2
    document = {
        "schemaVersion": 1,
        "id": "snapshot-one",
        "datasetId": "dataset-one",
        "modelId": "model-one",
        "createdAt": "2026-08-27T00:00:00.000Z",
        "classes": ["seed"],
        "images": [
            {**annotation["image"], "split": "train", "annotation": annotation},
            {
                **annotation["image"],
                "digest": "d" * 64,
                "split": "val",
                "annotation": {
                    **_fixture("annotation.json"),
                    "image": {**annotation["image"], "digest": "d" * 64},
                },
            },
        ],
    }
    with pytest.raises(ValueError) as error:
        TrainingSnapshot.from_document(document, "claimed snapshot")
    assert str(error.value).startswith(
        "claimed snapshot.images[0].annotation.instances[1].id is a duplicate:"
    )
