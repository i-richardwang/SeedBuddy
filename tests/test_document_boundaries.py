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
