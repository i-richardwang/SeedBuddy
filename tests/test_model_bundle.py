from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from vitroctl.cli import main
from vitroctl.models.bundle import (
    read_bundle,
    training_bundle,
    validate_bundle,
    weights_descriptor,
    write_bundle,
)
from vitroctl.models.client import WorkbenchClient


def bundle(weights: Path, recipe):
    return {
        "schemaVersion": 1,
        "classes": ["seed"],
        "weights": weights_descriptor(weights),
        "inference": {
            "mode": "whole_image",
            "iou": 0.7,
            "confidence": 0.26,
            "imageSize": 1536,
            "maxDetections": 500,
            "endToEnd": False,
        },
        "training": recipe,
        "validation": {
            "precision": 0.5,
            "recall": 0.4,
            "map50": 0.5,
            "map50To95": 0.3,
            "fitness": 0.3,
        },
        "provenance": {
            "dataset": {
                "fingerprint": None,
                "snapshotId": None,
                "description": "Independent experiment",
            },
            "selectedEpoch": 30,
            "codeRevision": None,
            "effectiveParameters": {"nbs": 8},
            "evaluation": {
                "description": "15 comparison images",
                "calibration": "8 calibration images",
                "metrics": {"countMae": 17.5},
            },
        },
    }


def test_bundle_preserves_weights_and_rejects_corruption_and_unknown_pipelines(
    tmp_path,
    recipe,
):
    weights = tmp_path / "last.pt"
    weights.write_bytes(b"trained once")
    document = bundle(weights, recipe)
    target = write_bundle(weights, document, tmp_path / "bundle")
    actual, copied = read_bundle(target)
    assert actual == document
    assert copied.read_bytes() == weights.read_bytes()
    copied.write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="digest or size"):
        read_bundle(target)
    document["inference"]["mode"] = "tiled"
    with pytest.raises(ValueError):
        validate_bundle(document, weights)


def test_import_only_prepares_uploads_and_registers_and_can_be_retried(
    tmp_path, monkeypatch, recipe
):
    weights = tmp_path / "last.pt"
    weights.write_bytes(b"trained once")
    document = bundle(weights, recipe)
    operations = []
    uploaded = []

    def post(url, **options):
        operations.append(url.rsplit("/", 1)[-1])
        assert options["headers"]["Authorization"] == "Bearer secret"
        result = (
            {"uploadId": "upload-123", "uploadPath": "https://untrusted.example/leak"}
            if operations[-1] == "prepare-model-upload"
            else {"id": "version-123"}
        )
        return httpx.Response(
            200, json={"result": result}, request=httpx.Request("POST", url)
        )

    def put(url, **options):
        assert (
            url
            == "https://workbench.example/api/agent/model-uploads/upload-123/weights"
        )
        uploaded.append(options["content"].read())
        return httpx.Response(200, request=httpx.Request("PUT", url))

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(httpx, "put", put)
    client = WorkbenchClient("https://workbench.example", "secret")
    assert client.import_bundle(document, weights, "seed") == {"id": "version-123"}
    assert client.import_bundle(document, weights, "seed") == {"id": "version-123"}
    assert operations == ["prepare-model-upload", "register-model-upload"] * 2
    assert uploaded == [b"trained once"] * 2


def test_cli_routes_remote_training_and_version_selection_to_shared_operations(
    tmp_path, monkeypatch, capsys, recipe
):
    operations = []
    monkeypatch.setenv("VITROFLOW_SERVER_URL", "https://workbench.example")
    monkeypatch.setenv("VITROFLOW_API_KEY", "secret")

    def call(self, name, args):
        operations.append((name, args))
        return {"id": "result"}

    monkeypatch.setattr(WorkbenchClient, "call", call)
    spec = tmp_path / "spec.json"
    spec.write_text(json.dumps({"dataset": "dataset-id", "recipe": recipe}))
    assert main(["training", "run", "--spec", str(spec), "--worker", "local-gpu"]) == 0
    assert operations[-1] == (
        "start-training-run",
        {"dataset": "dataset-id", "recipe": recipe, "targetWorkerId": "local-gpu"},
    )
    assert main(["training", "workers"]) == 0
    assert operations[-1] == ("list-training-workers", {})
    assert main(["models", "use", "--model", "seed", "--version", "version-123"]) == 0
    assert operations[-1] == (
        "use-model-version",
        {"model": "seed", "version": "version-123"},
    )
    assert (
        main(
            [
                "training",
                "resume",
                "train-id",
                "--dataset",
                "dataset-id",
                "--attempt",
                "2",
                "--worker",
                "other",
            ]
        )
        == 0
    )
    assert operations[-1][1]["control"] == {
        "action": "resume",
        "targetWorkerId": "other",
        "restart": False,
    }


def test_local_training_produces_a_portable_bundle_once_and_refuses_changed_resume_inputs(
    tmp_path, monkeypatch, recipe
):
    from types import SimpleNamespace

    from vitroctl.cli import training

    spec = tmp_path / "training.json"
    spec.write_text(json.dumps({"dataset": "local", "recipe": recipe}))
    manifest = SimpleNamespace(
        dataset="local",
        classes=("seed",),
        to_dict=lambda: {"images": [], "classes": ["seed"]},
    )
    monkeypatch.setattr(training, "load_dataset_manifest", lambda _: manifest)
    monkeypatch.setattr(training, "load_annotations", lambda _: [])

    def export(_annotations, _classes, _root, destination, **_options):
        destination.mkdir(parents=True)
        (destination / "dataset.yaml").write_text("train: images/train")
        (destination / "manifest.json").write_text(
            json.dumps({"class_names": ["seed"], "images": []})
        )

    monkeypatch.setattr(training, "export_yolo_dataset", export)
    calls = []

    def train(_dataset, output, **options):
        calls.append(options)
        output.mkdir()
        weights = output / "best.pt"
        weights.write_bytes(b"trained once")
        metadata = bundle(weights, recipe)
        (output / "training-context.json").write_text(
            json.dumps(
                {
                    "codeRevision": "sha256:" + "a" * 64,
                    "effectiveParameters": recipe["parameters"],
                }
            )
        )
        summary = output / "inference.json"
        summary.write_text(
            json.dumps(
                {
                    "inference": {
                        k: v
                        for k, v in metadata["inference"].items()
                        if k not in {"mode", "iou"}
                    }
                    | {"ready": True},
                    "training": recipe,
                    "validation": metadata["validation"],
                }
            )
        )
        return SimpleNamespace(
            best_weights=weights, summary=summary, metrics=metadata["validation"]
        )

    monkeypatch.setattr(training, "train_yolo_detector", train)
    output = tmp_path / "run"
    args = ["training", "run", "--local", "--spec", str(spec), "--output", str(output)]
    assert main(args) == 0
    document, weights = read_bundle(output / "bundle")
    assert document["classes"] == ["seed"]
    assert document["provenance"]["dataset"]["fingerprint"] is not None
    assert document["provenance"]["codeRevision"] == "sha256:" + "a" * 64
    assert document["provenance"]["effectiveParameters"] == recipe["parameters"]
    assert weights.read_bytes() == b"trained once"
    assert main(args) == 2
    recipe["parameters"]["epochs"] += 1
    spec.write_text(json.dumps({"dataset": "local", "recipe": recipe}))
    assert main(args + ["--resume"]) == 2
    assert len(calls) == 1
    (output / "training" / "training-context.json").unlink()
    with pytest.raises(FileNotFoundError):
        training_bundle(
            output / "training" / "best.pt",
            output / "training" / "inference.json",
            ["seed"],
            document["provenance"],
        )


@pytest.mark.parametrize("size", [2560, 3072])
def test_high_resolution_bundle_roundtrips(tmp_path, size, recipe):
    weights = tmp_path / "last.pt"
    weights.write_bytes(b"high resolution weights")
    document = bundle(weights, recipe)
    document["training"]["parameters"]["imgsz"] = size
    document["inference"]["imageSize"] = size
    target = write_bundle(weights, document, tmp_path / "bundle")
    assert read_bundle(target)[0] == document
    document["training"]["parameters"]["imgsz"] = 3104
    with pytest.raises(ValueError, match="imgsz"):
        validate_bundle(document, weights)
