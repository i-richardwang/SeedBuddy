from __future__ import annotations

import json

import httpx
import pytest
from conftest import model_bundle

from vitroctl.cli import main
from vitroctl.detectors.ultralytics import YoloTrainingResult
from vitroctl.models.bundle import (
    read_bundle,
    training_bundle,
    validate_bundle,
    write_bundle,
)
from vitroctl.models.client import WorkbenchClient


def test_bundle_preserves_weights_and_rejects_corruption_and_unknown_inference_modes(
    tmp_path,
    recipe,
):
    weights = tmp_path / "last.pt"
    weights.write_bytes(b"trained once")
    document = model_bundle(weights, recipe)
    target = write_bundle(weights, document, tmp_path / "bundle")
    actual, copied = read_bundle(target)
    assert actual == document
    assert copied.read_bytes() == weights.read_bytes()
    copied.write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="digest or size"):
        read_bundle(target)
    document["inference"]["mode"] = "tiled"
    with pytest.raises(ValueError, match="inference.mode.*whole_image"):
        validate_bundle(document, weights)


def test_import_only_prepares_uploads_and_registers_and_can_be_retried(
    tmp_path, monkeypatch, recipe
):
    weights = tmp_path / "last.pt"
    weights.write_bytes(b"trained once")
    document = model_bundle(weights, recipe)
    operations = []
    uploaded = []

    def handle(request):
        assert request.headers["Authorization"] == "Bearer secret"
        assert request.url.host == "workbench.example"
        if request.method == "PUT":
            assert request.url.path == "/api/agent/model-uploads/upload-123/weights"
            uploaded.append(request.content)
            return httpx.Response(200)
        operations.append(request.url.path.rsplit("/", 1)[-1])
        result = (
            {"uploadId": "upload-123", "uploadPath": "https://untrusted.example/leak"}
            if operations[-1] == "prepare-model-upload"
            else {"id": "version-123"}
        )
        return httpx.Response(200, json={"result": result})

    from vitroctl.io.http import authorized_client
    from vitroctl.models import client as client_module

    def connected(server, token, **options):
        return authorized_client(
            server, token, transport=httpx.MockTransport(handle), **options
        )

    monkeypatch.setattr(client_module, "authorized_client", connected)
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
        annotated=(),
        classes=("seed",),
        to_dict=lambda: {"images": [], "classes": ["seed"]},
    )
    monkeypatch.setattr(training, "load_dataset_manifest", lambda _: manifest)

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
        metadata = model_bundle(weights, recipe)
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
            best_weights=weights,
            summary=summary,
            context={
                "codeRevision": "sha256:" + "a" * 64,
                "effectiveParameters": recipe["parameters"],
            },
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


@pytest.mark.parametrize("size", [2560, 3072])
def test_high_resolution_bundle_roundtrips(tmp_path, size, recipe):
    weights = tmp_path / "last.pt"
    weights.write_bytes(b"high resolution weights")
    document = model_bundle(weights, recipe)
    document["training"]["parameters"]["imgsz"] = size
    document["inference"]["imageSize"] = size
    target = write_bundle(weights, document, tmp_path / "bundle")
    assert read_bundle(target)[0] == document
    document["training"]["parameters"]["imgsz"] = 3104
    with pytest.raises(ValueError, match="imgsz"):
        validate_bundle(document, weights)


def test_training_bundle_refuses_unusable_validation(tmp_path):
    summary = tmp_path / "inference.json"
    summary.write_text(json.dumps({"inference": {"ready": False}}))
    with pytest.raises(ValueError, match="usable validation"):
        training_bundle(
            YoloTrainingResult(tmp_path / "best.pt", summary, {}), ["seed"], {}
        )


@pytest.mark.parametrize("invalid_structure", [False, True])
def test_pack_validates_before_runtime_and_never_publishes_a_rejected_bundle(
    tmp_path, monkeypatch, recipe, invalid_structure
):
    from vitroctl.cli import models
    from vitroctl.contracts import validation

    weights = tmp_path / "weights.pt"
    weights.write_bytes(b"weights")
    document = model_bundle(weights, recipe)
    if invalid_structure:
        document["classes"] = ["seed", "seed"]
    metadata = tmp_path / "metadata.json"
    metadata.write_text(json.dumps(document))
    target = tmp_path / "bundle"
    checked = []
    runtime_calls = []
    validator = validation._validator

    def track(name):
        checked.append(name)
        return validator(name)

    def reject(document, source):
        runtime_calls.append(source)
        raise ValueError("Weights declare different classes")

    monkeypatch.setattr(validation, "_validator", track)
    monkeypatch.setattr(models, "_verify_runtime", reject)
    assert (
        main(
            [
                "models",
                "pack",
                "--weights",
                str(weights),
                "--metadata",
                str(metadata),
                "--output",
                str(target),
            ]
        )
        == 2
    )
    assert checked == ["model-bundle"]
    assert runtime_calls == ([] if invalid_structure else [weights])
    assert not target.exists()


def test_remote_training_rejects_invalid_recipe_before_send(
    tmp_path, monkeypatch, recipe
):
    monkeypatch.setenv("VITROFLOW_SERVER_URL", "https://workbench.example")
    monkeypatch.setenv("VITROFLOW_API_KEY", "secret")
    calls = []
    monkeypatch.setattr(WorkbenchClient, "call", lambda *args: calls.append(args))
    recipe["parameters"]["epochs"] = 0
    spec = tmp_path / "spec.json"
    spec.write_text(json.dumps({"dataset": "dataset-id", "recipe": recipe}))
    assert main(["training", "run", "--spec", str(spec)]) == 2
    assert calls == []


@pytest.mark.parametrize(
    "arguments, message",
    [
        (["--data-root", "data"], "apply only to --local"),
        (["--local", "--worker", "other"], "cannot be combined"),
        (["--local"], "requires --output"),
    ],
)
def test_training_mode_conflicts_fail_before_reading_the_spec(
    tmp_path, capsys, arguments, message
):
    assert (
        main(["training", "run", "--spec", str(tmp_path / "absent.json"), *arguments])
        == 2
    )
    assert message in capsys.readouterr().err


def test_training_bundle_uses_result_context_and_one_metric_source(tmp_path, recipe):
    from vitroctl.models.bundle import training_provenance

    weights = tmp_path / "weights.pt"
    weights.write_bytes(b"trained")
    template = model_bundle(weights, recipe)
    summary = tmp_path / "publication.json"
    summary.write_text(
        json.dumps(
            {
                "inference": {
                    key: value
                    for key, value in template["inference"].items()
                    if key not in {"mode", "iou"}
                }
                | {"ready": True},
                "training": recipe,
                "validation": template["validation"],
            }
        )
    )
    context = {"codeRevision": "supplied revision", "effectiveParameters": {"batch": 2}}
    result = YoloTrainingResult(weights, summary, context)
    provenance = training_provenance(
        fingerprint=None,
        snapshot_id="snapshot-one",
        dataset_description="dataset",
        evaluation_description="validation",
    )
    document = training_bundle(result, ["seed"], provenance)
    assert document["provenance"]["codeRevision"] == "supplied revision"
    assert document["provenance"]["effectiveParameters"] == {"batch": 2}
    assert document["provenance"]["evaluation"]["metrics"] is document["validation"]
