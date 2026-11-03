from __future__ import annotations

import json
import sys
import threading
import time
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from conftest import PARAMETERS, annotation_document, encoded_image, write_blob

from vitroctl.detectors.ultralytics import (
    DetectionLosses,
    EpochReport,
    YoloTrainingInterruptedError,
)
from vitroctl.io.image_io import CANONICAL_EXTENSION
from vitroctl.worker import session as worker_session
from vitroctl.worker import training as training_worker
from vitroctl.worker.images import ImageCache
from vitroctl.worker.session import (
    LeaseLostError,
    WorkerClient,
    WorkerSession,
    keep_lease,
)
from vitroctl.worker.training import (
    TrainingClaim,
    TrainingClient,
    materialize_snapshot,
    parse_training_snapshot,
)


def _parameters(**overrides: object) -> dict[str, object]:
    return {**PARAMETERS, **overrides}


def _run(
    run_id: str = "train-one", *, parameters: dict[str, object] | None = None
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "id": run_id,
        "modelId": "set",
        "datasetSnapshotId": "snapshot-one",
        "createdAt": "2026-08-27T00:00:00.000Z",
        "attempt": 1,
        "targetWorkerId": None,
        "lastProgressAt": None,
        "checkpoint": None,
        "recipe": {
            "baseModel": {"reference": "yolo26n.pt", "digest": "a" * 64},
            "parameters": parameters or PARAMETERS,
            "runtime": {"framework": "ultralytics", "version": "8.4.131"},
        },
        "state": {
            "status": "running",
            "workerId": "trainer",
            "sessionId": "trainer-session",
            "leaseExpiresAt": "2026-08-27T00:05:00.000Z",
            "phase": "preparing",
            "progress": 0.0,
        },
    }


def _snapshot(images: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "id": "snapshot-one",
        "datasetId": "set",
        "modelId": "set",
        "classes": ["ungerminated", "germinated"],
        "createdAt": "2026-08-27T00:00:00.000Z",
        "images": images,
    }


def _snapshot_image(
    digest: str, split: str, boxes: list[dict[str, float]]
) -> dict[str, object]:
    return {
        "digest": digest,
        "width": 100,
        "height": 80,
        "split": split,
        "annotation": annotation_document(digest, boxes),
    }


def session(memory_bytes: int) -> WorkerSession:
    return WorkerSession(
        "trainer-session", "2026-08-27T00:00:00.000Z", (), memory_bytes
    )


def test_worker_memory_capacity_follows_the_selected_device(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pages = {"SC_PAGE_SIZE": 4096, "SC_PHYS_PAGES": 1_000_000}
    monkeypatch.setattr(worker_session.os, "sysconf", pages.__getitem__)
    assert worker_session.device_memory_bytes("cpu") == 4_096_000_000

    cuda_devices: list[int] = []

    def cuda_memory(index: int) -> tuple[int, int]:
        cuda_devices.append(index)
        return 8_000_000_000, 24_000_000_000

    torch = SimpleNamespace(
        mps=SimpleNamespace(recommended_max_memory=lambda: 18_000_000_000),
        cuda=SimpleNamespace(mem_get_info=cuda_memory),
    )
    monkeypatch.setitem(sys.modules, "torch", torch)

    assert worker_session.device_memory_bytes("mps") == 18_000_000_000
    assert worker_session.device_memory_bytes("cuda") == 24_000_000_000
    assert worker_session.device_memory_bytes("cuda:2") == 24_000_000_000
    assert cuda_devices == [0, 2]


def test_training_client_uses_its_own_control_plane_contract(tmp_path: Path) -> None:
    requests: list[httpx.Request] = []
    images = {}
    for variant in range(2):
        pixels = encoded_image(variant=variant)
        images[write_blob(tmp_path / "unused", pixels)] = pixels
    train_digest, val_digest = images
    snapshot = _snapshot(
        [
            _snapshot_image(
                train_digest, "train", [{"x": 10, "y": 20, "width": 8, "height": 6}]
            ),
            _snapshot_image(val_digest, "val", []),
        ]
    )
    run = _run()

    def server(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == "Bearer training-secret"
        if request.url.path == "/api/worker/heartbeat":
            return httpx.Response(200, json={})
        if request.url.path == "/api/worker/training/claim":
            return httpx.Response(200, json={"run": run})
        if request.url.path == "/api/worker/training/runs/train-one/snapshot":
            return httpx.Response(200, json=snapshot)
        digest = request.url.path.removeprefix(
            "/api/worker/training/runs/train-one/images/"
        )
        if digest in images:
            return httpx.Response(200, content=images[digest])
        return httpx.Response(404)

    client = TrainingClient(
        WorkerClient(
            "https://example.test",
            "training-secret",
            session(24 * 1024**3),
            transport=httpx.MockTransport(server),
        )
    )
    try:
        client.worker.heartbeat()
        job = client.claim()
        assert job is not None
        dataset_yaml = materialize_snapshot(
            client, job, tmp_path / "dataset", images=ImageCache(tmp_path / "images")
        )
    finally:
        client.worker.close()

    assert json.loads(requests[0].content)["memoryBytes"] == 24 * 1024**3
    assert json.loads(requests[0].content)["sessionId"] == "trainer-session"
    paths = [request.url.path for request in requests]
    assert paths[:3] == [
        "/api/worker/heartbeat",
        "/api/worker/training/claim",
        "/api/worker/training/runs/train-one/snapshot",
    ]
    # The images download concurrently, in no fixed order.
    assert sorted(paths[3:]) == sorted(
        f"/api/worker/training/runs/train-one/images/{digest}"
        for digest in (train_digest, val_digest)
    )
    train_image = next((tmp_path / "dataset/images/train").iterdir())
    train_label = next((tmp_path / "dataset/labels/train").iterdir())
    val_label = next((tmp_path / "dataset/labels/val").iterdir())
    assert train_image.name == f"{train_digest}{CANONICAL_EXTENSION}"
    assert train_label.name == f"{train_digest}.txt"
    assert val_label.name == f"{val_digest}.txt"
    assert train_image.read_bytes() == images[train_digest]
    assert train_label.read_text().strip() == (
        "0 0.14000000 0.28750000 0.08000000 0.07500000"
    )
    assert val_label.read_text() == ""
    assert dataset_yaml.read_text() == (
        "train: images/train\nval: images/val\nnames:\n  0: ungerminated\n  1: germinated\n"
    )


def test_a_run_fetches_only_the_images_this_machine_does_not_hold(
    tmp_path: Path,
) -> None:
    images = {}
    for variant in range(3):
        pixels = encoded_image(variant=variant)
        images[write_blob(tmp_path / "unused", pixels)] = pixels
    held, torn, missing = images
    snapshot = parse_training_snapshot(
        _snapshot(
            [
                _snapshot_image(held, "train", []),
                _snapshot_image(torn, "train", []),
                _snapshot_image(missing, "val", []),
            ]
        )
    )
    cache_root = tmp_path / "images"
    earlier = ImageCache(cache_root)
    with earlier.holding([held], images.__getitem__) as pending:
        pending[held].result()
    earlier.close()
    # A write a crash cut short never became an image.
    (cache_root / ".partial").mkdir(exist_ok=True)
    (cache_root / ".partial" / f"{torn}.cut").write_bytes(images[torn][:10])
    requested: list[str] = []

    class Client:
        def fetch_snapshot(self, _job: TrainingClaim):
            requested.append("snapshot")
            return snapshot

        def download_image(self, _job: TrainingClaim, digest: str) -> bytes:
            requested.append(digest)
            return images[digest]

    cache = ImageCache(cache_root)
    job = TrainingClaim.parse(_run())
    dataset = materialize_snapshot(Client(), job, tmp_path / "one", images=cache)  # type: ignore[arg-type]
    first = list(requested)
    again = materialize_snapshot(Client(), job, tmp_path / "one", images=cache)  # type: ignore[arg-type]
    materialize_snapshot(Client(), job, tmp_path / "two", images=cache)  # type: ignore[arg-type]
    cache.close()

    assert first[0] == "snapshot"
    assert sorted(first[1:]) == sorted([torn, missing])
    assert again == dataset
    assert requested == [*first, "snapshot"]
    linked = tmp_path / f"one/images/train/{torn}{CANONICAL_EXTENSION}"
    assert linked.read_bytes() == images[torn]
    assert linked.stat().st_ino == cache.path(torn).stat().st_ino


def test_snapshot_parser_validates_every_image_entry() -> None:
    snapshot = parse_training_snapshot(
        _snapshot(
            [
                _snapshot_image("1" * 64, "val", []),
                _snapshot_image("2" * 64, "train", []),
            ]
        )
    )
    assert snapshot.id == "snapshot-one"
    assert snapshot.images[0].split == "val"
    assert snapshot.images[0].annotation.digest == "1" * 64

    valid_images = [
        _snapshot_image("1" * 64, "val", []),
        _snapshot_image("2" * 64, "train", []),
    ]
    with pytest.raises(ValueError, match=r"snapshot.schemaVersion.*shared contract"):
        parse_training_snapshot({**_snapshot(valid_images), "schemaVersion": 99})
    with pytest.raises(
        ValueError, match=r"snapshot.images\[0\].split.*shared contract"
    ):
        parse_training_snapshot(
            _snapshot(
                [
                    _snapshot_image("1" * 64, "test", []),
                    _snapshot_image("2" * 64, "train", []),
                ]
            )
        )
    with pytest.raises(ValueError, match=r"images\[0\].annotation describes another"):
        parse_training_snapshot(
            _snapshot(
                [
                    {**_snapshot_image("1" * 64, "val", []), "digest": "2" * 64},
                    _snapshot_image("3" * 64, "train", []),
                ]
            )
        )


def test_training_client_rejects_snapshot_image_corruption() -> None:
    client = TrainingClient(
        WorkerClient(
            "https://example.test",
            "secret",
            session(8 * 1024**3),
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, content=b"bad")
            ),
        )
    )
    try:
        with pytest.raises(ValueError, match="digest verification"):
            client.download_image(TrainingClaim.parse(_run()), "a" * 64)
    finally:
        client.worker.close()


def test_training_client_surfaces_lease_loss() -> None:
    client = TrainingClient(
        WorkerClient(
            "https://example.test",
            "secret",
            session(8 * 1024**3),
            transport=httpx.MockTransport(
                lambda _: httpx.Response(409, text="lease expired")
            ),
        )
    )
    try:
        with pytest.raises(LeaseLostError, match="lease expired"):
            client.renew_lease(TrainingClaim.parse(_run()))
    finally:
        client.worker.close()


def test_claim_response_requires_a_run_object() -> None:
    client = TrainingClient(
        WorkerClient(
            "https://example.test",
            "secret",
            session(8 * 1024**3),
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, content=json.dumps({"run": []}))
            ),
        )
    )
    try:
        with pytest.raises(ValueError, match="training run.*shared contract"):
            client.claim()
    finally:
        client.worker.close()


def test_training_claim_parses_the_complete_claim_contract() -> None:
    fixture = Path(__file__).parent / "fixtures" / "contracts" / "training-claim.json"
    response = json.loads(fixture.read_text(encoding="utf-8"))
    job = TrainingClaim.parse(response["run"])

    assert job.run_id == "train-one"
    assert job.model_id == "seed-detector"
    assert job.dataset_snapshot_id == "snapshot-one"
    assert job.worker_id == "trainer"
    assert job.session_id == "trainer-session"
    assert job.phase == "preparing"


def test_training_claim_rejects_partial_or_foreign_claim_state() -> None:
    with pytest.raises(ValueError, match="training run.*shared contract"):
        TrainingClaim.parse({"schemaVersion": 1, "id": "train-one"})
    malformed = _run()
    malformed["state"] = {"status": "running"}
    with pytest.raises(ValueError, match="training run.state.*shared contract"):
        TrainingClaim.parse(malformed)


def test_snapshot_materialization_honors_shutdown_before_network_access(
    tmp_path: Path,
) -> None:
    class UnexpectedClient:
        def fetch_snapshot(self, _job: TrainingClaim) -> None:
            pytest.fail("cancelled materialization must not request a snapshot")

    with pytest.raises(YoloTrainingInterruptedError, match="interrupted"):
        materialize_snapshot(
            UnexpectedClient(),  # type: ignore[arg-type]
            TrainingClaim.parse(_run()),
            tmp_path / "dataset",
            images=ImageCache(tmp_path / "images"),
            cancelled=lambda: True,
        )


def test_lease_refresh_failure_cancels_training_and_surfaces_lease_loss(
    monkeypatch,
) -> None:
    class FailingClient:
        renew_calls = 0

        def renew_lease(self, _job: TrainingClaim) -> None:
            self.renew_calls += 1
            if self.renew_calls > 1:
                raise OSError("connection lost")

        def heartbeat(self) -> None:
            return None

    monkeypatch.setattr(worker_session, "LEASE_REFRESH_SECONDS", 0.001)
    deadline = time.monotonic() + 1

    client = FailingClient()
    with (
        pytest.raises(LeaseLostError, match="refresh failed"),
        keep_lease(
            client,  # type: ignore[arg-type]
            lambda: client.renew_lease(TrainingClaim.parse(_run())),
        ) as cancelled,
    ):
        while not cancelled() and time.monotonic() < deadline:
            time.sleep(0.001)
        assert cancelled()
        raise YoloTrainingInterruptedError("training interrupted")


@pytest.mark.parametrize("delivery_fails", [False, True])
def test_training_claim_reports_each_epoch_and_publishes_the_artifact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, delivery_fails: bool
) -> None:
    posted: list[tuple[str, dict[str, object]]] = []
    artifacts: list[tuple[str, bytes, dict[str, object]]] = []

    class Client:
        worker = SimpleNamespace(heartbeat=lambda: None)

        def enter_phase(self, job: TrainingClaim, phase: str) -> None:
            posted.append((job.run_id, {"phase": phase}))

        def renew_lease(self, job: TrainingClaim) -> None:
            posted.append((job.run_id, {"lease": "renewed"}))

        def report_epoch(self, job: TrainingClaim, report: EpochReport) -> None:
            posted.append((job.run_id, report.to_json()))

        def publish_artifact(
            self, job: TrainingClaim, weights: Path, inference: Path
        ) -> None:
            if delivery_fails:
                raise RuntimeError("delivery unavailable")
            artifacts.append(
                (job.run_id, weights.read_bytes(), json.loads(inference.read_text()))
            )

        def report_failure(self, job: TrainingClaim, error: str) -> None:
            if not delivery_fails:
                pytest.fail(f"unexpected failure report: {error}")

    def materialize(_client, _job, output: Path, **_options) -> Path:
        output.mkdir(parents=True)
        dataset = output / "dataset.yaml"
        dataset.write_text("train: images/train\nval: images/val\n")
        (output / "manifest.json").write_text(
            json.dumps({"class_names": ["ungerminated", "germinated"]})
        )
        return dataset

    def train(
        dataset,
        output_dir,
        *,
        parameters,
        on_training_start,
        on_epoch,
        on_validation_start,
        **options,
    ):
        assert parameters == _parameters(epochs=2)
        assert options["model"] == "yolo26n.pt"
        assert options["model_digest"] == "a" * 64
        assert options["runtime_version"] == "8.4.131"
        assert options["device"] == "mps"
        output = Path(output_dir)
        (output / "weights").mkdir(parents=True)
        (output / "weights" / "best.pt").write_bytes(b"weights")
        (output / "training-context.json").write_text(
            json.dumps(
                {
                    "codeRevision": "sha256:" + "a" * 64,
                    "effectiveParameters": parameters,
                }
            )
        )
        summary = output / "inference.json"
        summary.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "inference": {
                        "ready": True,
                        "confidence": 0.3,
                        "imageSize": 768,
                        "maxDetections": 500,
                        "endToEnd": False,
                    },
                    "validation": {
                        "precision": 0.5,
                        "recall": 0.4,
                        "map50": 0.45,
                        "map50To95": 0.2,
                        "fitness": 0.225,
                    },
                    "training": _run(parameters=parameters)["recipe"],
                }
            )
        )
        on_training_start()
        for epoch in (1, 2):
            on_epoch(
                EpochReport(
                    epoch=epoch,
                    train=DetectionLosses(1.0, 2.0, 0.5),
                    val=DetectionLosses(1.1, 2.1, 0.6),
                    precision=0.5,
                    recall=0.4,
                    map50=0.45,
                    map50_to_95=0.2,
                    fitness=0.225,
                    learning_rate=0.001,
                )
            )
        on_validation_start()
        return SimpleNamespace(
            best_weights=output / "weights" / "best.pt",
            summary=summary,
            metrics={},
            confidence=0.3,
        )

    monkeypatch.setattr(training_worker, "materialize_snapshot", materialize)
    monkeypatch.setattr(training_worker, "run_training_process", train)
    job = TrainingClaim.parse(_run(parameters=_parameters(epochs=2)))

    with (
        pytest.raises(RuntimeError, match="delivery unavailable")
        if delivery_fails
        else nullcontext()
    ):
        training_worker.serve_training_claim(
            Client(),  # type: ignore[arg-type]
            job,
            tmp_path,
            "mps",
            ImageCache(tmp_path / "images"),
            stopped=threading.Event(),
        )
    if delivery_fails:
        from vitroctl.models.bundle import read_bundle

        retained = tmp_path / "training-runs" / "train-one-1" / "bundle"
        assert read_bundle(retained)[1].read_bytes() == b"weights"
        return

    assert [entry["phase"] for _, entry in posted if "phase" in entry] == [
        "preparing",
        "training",
        "validating",
    ]
    assert [entry["epoch"] for _, entry in posted if "epoch" in entry] == [1, 2]
    assert [entry["lease"] for _, entry in posted if "lease" in entry] == ["renewed"]
    assert len(artifacts) == 1
    assert artifacts[0][:2] == ("train-one", b"weights")
    assert artifacts[0][2]["classes"] == ["ungerminated", "germinated"]
    from vitroctl.contracts.validation import validate_wire_contract

    validate_wire_contract("model-bundle", artifacts[0][2], "published bundle")
    assert not (tmp_path / "training-runs" / "train-one-1").exists()


def test_interrupted_training_claim_cleans_its_attempt_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    outputs: list[Path] = []

    class Client:
        worker = SimpleNamespace(heartbeat=lambda: None)

        def enter_phase(self, _job: TrainingClaim, _phase: str) -> None:
            return None

        def renew_lease(self, _job: TrainingClaim) -> None:
            return None

        def report_failure(self, job: TrainingClaim, error: str) -> None:
            pytest.fail(f"an interruption is not a failure: {error}")

    def materialize(_client, _job, output: Path, **_options) -> Path:
        output.mkdir(parents=True, exist_ok=True)
        return output / "dataset.yaml"

    def interrupted(_dataset, output_dir, **_options):
        outputs.append(Path(output_dir))
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        raise YoloTrainingInterruptedError("training interrupted")

    monkeypatch.setattr(training_worker, "materialize_snapshot", materialize)
    monkeypatch.setattr(training_worker, "run_training_process", interrupted)
    job = TrainingClaim.parse(_run())

    for _ in range(2):
        with pytest.raises(YoloTrainingInterruptedError):
            training_worker.serve_training_claim(
                Client(),  # type: ignore[arg-type]
                job,
                tmp_path,
                "mps",
                ImageCache(tmp_path / "images"),
                stopped=threading.Event(),
            )

    assert outputs[0] == outputs[1] == tmp_path / "training-runs/train-one-1/run"
    assert not outputs[0].exists()


def test_training_claim_reports_an_unexpected_adapter_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    failures: list[tuple[str, str]] = []

    class Client:
        worker = SimpleNamespace(heartbeat=lambda: None)

        def enter_phase(self, _job: TrainingClaim, _phase: str) -> None:
            return None

        def renew_lease(self, _job: TrainingClaim) -> None:
            return None

        def report_failure(self, job: TrainingClaim, error: str) -> None:
            failures.append((job.run_id, error))

    def broken_materialization(*_args, **_kwargs) -> Path:
        raise KeyError("unexpected Ultralytics field")

    monkeypatch.setattr(training_worker, "materialize_snapshot", broken_materialization)
    job = TrainingClaim.parse(_run("train-broken"))

    with pytest.raises(KeyError, match="unexpected Ultralytics field"):
        training_worker.serve_training_claim(
            Client(),  # type: ignore[arg-type]
            job,
            tmp_path,
            "mps",
            ImageCache(tmp_path / "images"),
            stopped=threading.Event(),
        )

    assert failures == [("train-broken", "'unexpected Ultralytics field'")]
    assert not (tmp_path / "training-runs" / "train-broken-1").exists()


def test_training_requests_keep_the_identity_of_their_job() -> None:
    from dataclasses import replace

    attempts: list[int] = []

    def respond(request: httpx.Request) -> httpx.Response:
        attempts.append(json.loads(request.content)["attempt"])
        return httpx.Response(200, json={})

    worker = WorkerClient(
        "https://example.test",
        "secret",
        session(8 * 1024**3),
        transport=httpx.MockTransport(respond),
    )
    client = TrainingClient(worker)
    first = TrainingClaim.parse(_run())
    try:
        client.renew_lease(replace(first, attempt=2))
        client.renew_lease(first)
        assert attempts == [2, 1]
        with pytest.raises(ValueError, match="another worker session"):
            client.renew_lease(replace(first, session_id="another-session"))
        assert attempts == [2, 1]
    finally:
        worker.close()


def test_local_checkpoint_resume_validates_identity_and_requires_original_worker(
    tmp_path,
):
    from dataclasses import replace

    from vitroctl.training.documents import TrainingCheckpoint
    from vitroctl.worker.local_training import prepare_local_training

    job = TrainingClaim.parse(_run())
    root = tmp_path / "train-one-1"
    root.mkdir()
    prepare_local_training(job, root)
    for name in ("weights/last.pt", "weights/best.pt", "epochs.jsonl"):
        path = root / "run" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{"epoch": 1}\n' if name.endswith("jsonl") else "weights")
    resumed = replace(
        job,
        attempt=2,
        checkpoint=TrainingCheckpoint(attempt=1, epoch=1, worker_id=job.worker_id),
    )
    destination = tmp_path / "train-one-2"
    destination.mkdir()
    prepare_local_training(resumed, destination)
    assert (destination / "run/weights/last.pt").read_bytes() == b"weights"
    assert (root / "run/weights/last.pt").exists()
    with pytest.raises(ValueError, match="another worker"):
        prepare_local_training(
            replace(resumed, worker_id="another-worker"), destination
        )
    with pytest.raises(ValueError, match="explicitly restart"):
        prepare_local_training(
            replace(resumed, dataset_snapshot_id="another-snapshot"), destination
        )
    (root / "run/weights/last.pt").unlink()
    with pytest.raises(ValueError, match="explicitly restart"):
        prepare_local_training(resumed, destination)


def test_final_artifact_uses_bounded_parts_and_retries_only_failed_requests(
    tmp_path, monkeypatch
):
    from hashlib import sha256

    monkeypatch.setattr(training_worker, "ARTIFACT_PART_BYTES", 64)
    monkeypatch.setattr("vitroctl.worker.connection.time.sleep", lambda _: None)
    payload = b"weights" * 40
    weights = tmp_path / "weights.pt"
    weights.write_bytes(payload)
    bundle = tmp_path / "bundle.json"
    descriptor = {"bytes": len(payload), "digest": sha256(payload).hexdigest()}
    bundle.write_text(json.dumps({"weights": descriptor}))
    requests = []
    stored = {}
    completions = 0

    def respond(request):
        nonlocal completions
        if request.method == "PUT":
            assert request.url.path.endswith("/artifact-parts")
            part = int(request.url.params["part"])
            requests.append(part)
            assert len(request.content) <= 64
            assert (
                request.headers["x-artifact-part-sha256"]
                == sha256(request.content).hexdigest()
            )
            if part == 1 and requests.count(1) == 1:
                return httpx.Response(503)
            stored[part] = request.content
            return httpx.Response(204)
        assert request.url.path.endswith("/artifact")
        assert json.loads(request.content)["weights"] == descriptor
        assert b"".join(stored[i] for i in range(len(stored))) == payload
        completions += 1
        if completions == 1:
            raise httpx.ReadTimeout("lost publication response")
        return httpx.Response(200, json={})

    worker = WorkerClient(
        "https://example.test",
        "secret",
        session(8 * 1024**3),
        transport=httpx.MockTransport(respond),
    )
    try:
        TrainingClient(worker).publish_artifact(
            TrainingClaim.parse(_run()), weights, bundle
        )
    finally:
        worker.close()
    assert requests[:4] == [0, 1, 1, 2]
    assert requests.count(0) == 1
    assert completions == 2


@pytest.mark.parametrize("cancelled", [False, True])
def test_retry_delivers_retained_bundle_without_training_again(
    tmp_path, monkeypatch, cancelled
):
    from dataclasses import replace
    from hashlib import sha256

    from vitroctl.training.documents import TrainingCheckpoint
    from vitroctl.worker.local_training import prepare_local_training

    job = TrainingClaim.parse(_run())
    source = tmp_path / "training-runs/train-one-1"
    source.mkdir(parents=True)
    prepare_local_training(job, source)
    (source / "bundle").mkdir()
    (source / "bundle/weights.pt").write_bytes(b"finished")
    (source / "bundle/bundle.json").write_text(
        json.dumps({"weights": {"bytes": 8, "digest": sha256(b"finished").hexdigest()}})
    )
    resumed = replace(
        job,
        attempt=2,
        checkpoint=TrainingCheckpoint(attempt=1, epoch=3, worker_id=job.worker_id),
    )
    monkeypatch.setattr(
        training_worker, "keep_lease", lambda *a, **kw: nullcontext(lambda: cancelled)
    )
    monkeypatch.setattr(
        training_worker,
        "run_training_process",
        lambda *a, **kw: pytest.fail("finished weights must not retrain"),
    )
    calls = []

    def respond(request):
        calls.append(request.url.path)
        return httpx.Response(200, json={})

    worker = WorkerClient(
        "https://example.test",
        "secret",
        session(8 * 1024**3),
        transport=httpx.MockTransport(respond),
    )
    images = ImageCache(tmp_path / "images")
    try:
        with (
            pytest.raises(YoloTrainingInterruptedError) if cancelled else nullcontext()
        ):
            training_worker.serve_training_claim(
                TrainingClient(worker),
                resumed,
                tmp_path,
                "cpu",
                images,
                stopped=threading.Event(),
            )
    finally:
        images.close()
        worker.close()
    if cancelled:
        assert not any(path.endswith(("artifact-parts", "artifact")) for path in calls)
        assert (tmp_path / "training-runs/train-one-2/bundle/weights.pt").exists()
        return
    assert any(path.endswith("artifact-parts") for path in calls)
    assert not any(path.endswith(("epochs", "checkpoint")) for path in calls)
    assert not (tmp_path / "training-runs/train-one-2").exists()


def test_epoch_reports_no_weight_bytes_and_interruption_retains_local_state(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(
        training_worker, "keep_lease", lambda *a, **kw: nullcontext(lambda: False)
    )
    monkeypatch.setattr(
        training_worker,
        "materialize_snapshot",
        lambda *a, **kw: tmp_path / "dataset.yaml",
    )
    calls = []

    def respond(request):
        calls.append((request.url.path, json.loads(request.content)))
        return httpx.Response(200, json={})

    def train(_dataset, output, **options):
        (output / "weights").mkdir(parents=True)
        (output / "weights/last.pt").write_bytes(b"local optimizer and weights")
        (output / "weights/best.pt").write_bytes(b"local best weights")
        (output / "epochs.jsonl").write_text('{"epoch": 1}\n')
        options["on_training_start"]()
        options["on_epoch"](
            EpochReport(
                epoch=1,
                train=DetectionLosses(1, 1, 1),
                val=DetectionLosses(1, 1, 1),
                precision=0.5,
                recall=0.5,
                map50=0.5,
                map50_to_95=0.3,
                fitness=0.3,
                learning_rate=0.001,
            )
        )
        raise YoloTrainingInterruptedError("paused")

    monkeypatch.setattr(training_worker, "run_training_process", train)
    worker = WorkerClient(
        "https://example.test",
        "secret",
        session(8 * 1024**3),
        transport=httpx.MockTransport(respond),
    )
    images = ImageCache(tmp_path / "images")
    try:
        with pytest.raises(YoloTrainingInterruptedError):
            training_worker.serve_training_claim(
                TrainingClient(worker),
                TrainingClaim.parse(_run()),
                tmp_path,
                "cpu",
                images,
                stopped=threading.Event(),
            )
    finally:
        images.close()
        worker.close()
    assert all(path.endswith(("phase", "epochs")) for path, _ in calls)
    assert [body["epoch"] for path, body in calls if path.endswith("epochs")] == [1]
    assert (tmp_path / "training-runs/train-one-1/run/weights/last.pt").exists()


def test_local_recovery_copy_is_atomic_and_retryable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from dataclasses import replace

    from vitroctl.training.documents import TrainingCheckpoint
    from vitroctl.worker import local_training

    job = TrainingClaim.parse(_run())
    source = tmp_path / "train-one-1"
    source.mkdir()
    local_training.prepare_local_training(job, source)
    (source / "bundle").mkdir()
    (source / "bundle/weights.pt").write_bytes(b"complete weights")
    resumed = replace(
        job,
        attempt=2,
        checkpoint=TrainingCheckpoint(attempt=1, epoch=1, worker_id=job.worker_id),
    )
    destination = tmp_path / "train-one-2"
    destination.mkdir()

    def interrupted_copy(_source, staging, **_options):
        (staging / "weights.pt").write_bytes(b"partial")
        raise OSError("disk unavailable")

    with monkeypatch.context() as patch:
        patch.setattr(local_training.shutil, "copytree", interrupted_copy)
        with pytest.raises(ValueError, match="missing or invalid"):
            local_training.prepare_local_training(resumed, destination)
    assert list(destination.iterdir()) == []
    assert (source / "bundle/weights.pt").read_bytes() == b"complete weights"

    local_training.prepare_local_training(resumed, destination)
    assert (destination / "bundle/weights.pt").read_bytes() == b"complete weights"
