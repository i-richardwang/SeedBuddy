from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from collections.abc import Callable
from concurrent.futures import CancelledError
from hashlib import sha256
from pathlib import Path

from vitroctl.contracts.documents import as_object, expect_fields
from vitroctl.detectors.ultralytics import (
    DatasetImage,
    EpochReport,
    YoloTrainingInterruptedError,
    export_dataset_images,
)
from vitroctl.io.image_io import verify_digest
from vitroctl.models.bundle import training_bundle, write_bundle
from vitroctl.training.documents import (
    TrainingJob,
    TrainingPhase,
    TrainingSnapshot,
    parse_training_snapshot,
)
from vitroctl.worker.images import ImageCache, wait_for
from vitroctl.worker.local_training import prepare_local_training
from vitroctl.worker.session import LeaseLostError, WorkerClient, keep_lease
from vitroctl.worker.training_process import run_training_process

LOGGER = logging.getLogger(__name__)

RUNS_DIRECTORY = "training-runs"
STALE_RUN_SECONDS = 7 * 24 * 60 * 60
ARTIFACT_PART_BYTES = 8 * 1024 * 1024


class TrainingClient:
    """The training protocol: claim a run, feed it, report on it, publish it."""

    def __init__(self, worker: WorkerClient) -> None:
        self.worker = worker

    def _identity(self, job: TrainingJob) -> dict[str, str | int]:
        if job.session_id != self.worker.session.session_id:
            raise ValueError("Training execution belongs to another worker session")
        return {"sessionId": job.session_id, "attempt": job.attempt}

    def claim(self) -> TrainingJob | None:
        response = self.worker.request(
            "POST",
            "api/worker/training/claim",
            json=self.worker.identity,
        )
        response.raise_for_status()
        document = as_object(response.json(), "training claim response")
        expect_fields(document, {"run"}, "training claim response")
        if document["run"] is None:
            return None
        job = TrainingJob.parse(document["run"])
        if job.session_id != self.worker.session.session_id:
            raise ValueError("Training claim returned another session's lease")
        return job

    def fetch_snapshot(self, job: TrainingJob) -> TrainingSnapshot:
        response = self.worker.request(
            "GET",
            f"api/worker/training/runs/{job.run_id}/snapshot",
            params=self._identity(job),
        )
        self.worker.require_current_session(response)
        return parse_training_snapshot(response.json())

    def enter_phase(self, job: TrainingJob, phase: TrainingPhase) -> None:
        response = self.worker.request(
            "POST",
            f"api/worker/training/runs/{job.run_id}/phase",
            json={
                **self._identity(job),
                "phase": phase,
            },
        )
        self.worker.require_current_session(response)

    def renew_lease(self, job: TrainingJob) -> None:
        response = self.worker.request(
            "POST",
            f"api/worker/training/runs/{job.run_id}/lease",
            json=self._identity(job),
        )
        self.worker.require_current_session(response)

    def report_epoch(self, job: TrainingJob, report: EpochReport) -> None:
        response = self.worker.request(
            "POST",
            f"api/worker/training/runs/{job.run_id}/epochs",
            json={**self._identity(job), **report.to_json()},
        )
        self.worker.require_current_session(response)

    def download_image(self, job: TrainingJob, digest: str) -> bytes:
        response = self.worker.request(
            "GET",
            f"api/worker/training/runs/{job.run_id}/images/{digest}",
            params=self._identity(job),
        )
        self.worker.require_current_session(response)
        return verify_digest(response.content, digest)

    def publish_artifact(self, job: TrainingJob, weights: Path, bundle: Path) -> None:
        document = json.loads(bundle.read_text())
        descriptor = document["weights"]
        identity = self._identity(job)
        url = f"api/worker/training/runs/{job.run_id}/artifact"
        if weights.stat().st_size != descriptor["bytes"]:
            raise ValueError("Final weights size differs from the model manifest")
        digest = sha256()
        with weights.open("rb") as stream:
            for part, chunk in enumerate(
                iter(lambda: stream.read(ARTIFACT_PART_BYTES), b"")
            ):
                digest.update(chunk)
                response = self.worker.request(
                    "PUT",
                    f"{url}-parts",
                    params={**identity, **descriptor, "part": part},
                    content=chunk,
                    headers={
                        "Content-Type": "application/octet-stream",
                        "X-Artifact-Part-SHA256": sha256(chunk).hexdigest(),
                    },
                )
                self.worker.require_current_session(response)
        if digest.hexdigest() != descriptor["digest"]:
            raise ValueError("Final weights digest differs from the model manifest")
        response = self.worker.request("POST", url, params=identity, json=document)
        self.worker.require_current_session(response)

    def report_failure(self, job: TrainingJob, error: str) -> None:
        response = self.worker.request(
            "POST",
            f"api/worker/training/runs/{job.run_id}/fail",
            json={**self._identity(job), "error": error[:2000]},
        )
        if response.status_code == 409:
            return
        response.raise_for_status()


def materialize_snapshot(
    client: TrainingClient,
    job: TrainingJob,
    output: Path,
    *,
    images: ImageCache,
    cancelled: Callable[[], bool] | None = None,
) -> Path:
    """
    Build the run's dataset from the images this machine already holds,
    fetching the rest concurrently. The dataset links the cached files, so
    it costs no second copy and a later run over the same images fetches
    nothing.
    """
    if cancelled and cancelled():
        raise YoloTrainingInterruptedError("training interrupted")
    dataset = output / "dataset.yaml"
    if dataset.is_file():
        # The export publishes atomically, so a dataset that exists is complete.
        return dataset
    snapshot = client.fetch_snapshot(job)
    if len(snapshot.images) < 2:
        raise ValueError("Training snapshot must contain at least two images")
    started = time.monotonic()
    with images.holding(
        (image.digest for image in snapshot.images),
        lambda digest: client.download_image(job, digest),
    ) as pending:
        dataset_images: list[DatasetImage] = []
        for image in snapshot.images:
            try:
                path = wait_for(pending[image.digest], cancelled)
            except CancelledError as error:
                raise YoloTrainingInterruptedError("training interrupted") from error
            dataset_images.append(
                DatasetImage(
                    digest=image.digest,
                    width=image.annotation.width,
                    height=image.annotation.height,
                    instances=image.annotation.instances,
                    split=image.split,
                    file_path=path,
                )
            )
        LOGGER.info(
            "gathered %d images for %s in %.1fs",
            len(dataset_images),
            job.run_id,
            time.monotonic() - started,
        )
        export_dataset_images(
            dataset_images,
            snapshot.classes,
            output.parent,
            output,
            link_images=True,
        )
    return dataset


def _prune_stale_runs(runs: Path) -> None:
    """Expire idle scratch directories while preserving recoverable local work."""
    if not runs.is_dir():
        return
    horizon = time.time() - STALE_RUN_SECONDS
    for directory in runs.iterdir():
        if (
            directory.is_dir()
            and not (directory / "bundle").is_dir()
            and not (directory / "run/weights/last.pt").is_file()
            and directory.stat().st_mtime < horizon
        ):
            shutil.rmtree(directory, ignore_errors=True)


def _train_bundle(
    client: TrainingClient,
    job: TrainingJob,
    root: Path,
    device: str | None,
    images: ImageCache,
    cancelled: Callable[[], bool],
) -> Path:
    """Train against the frozen snapshot and produce the final model bundle."""
    recipe = job.recipe
    dataset = materialize_snapshot(
        client,
        job,
        root / "dataset",
        images=images,
        cancelled=cancelled,
    )

    result = run_training_process(
        dataset,
        root / "run",
        parameters=recipe.parameters,
        model=recipe.base_model_reference,
        model_digest=recipe.base_model_digest,
        runtime_version=recipe.runtime_version,
        device=device,
        cancelled=cancelled,
        on_training_start=lambda: client.enter_phase(job, "training"),
        on_epoch=lambda epoch: client.report_epoch(job, epoch),
        resume_required=job.checkpoint is not None,
        on_validation_start=lambda: client.enter_phase(job, "validating"),
    )
    if cancelled():
        raise YoloTrainingInterruptedError("training interrupted")
    if result.confidence is None:
        raise RuntimeError("Training completed without a usable validation signal")
    exported = json.loads((root / "dataset" / "manifest.json").read_text())
    document = training_bundle(
        result.best_weights,
        result.summary,
        exported["class_names"],
        {
            "dataset": {
                "fingerprint": None,
                "snapshotId": job.dataset_snapshot_id,
                "description": "Reviewed training snapshot",
            },
            "selectedEpoch": None,
            "evaluation": {
                "description": "Validation split of the training snapshot",
                "calibration": "Best F1 confidence on validation split",
                "metrics": result.metrics,
            },
        },
    )
    return write_bundle(result.best_weights, document, root / "bundle")


def process_training_job(
    client: TrainingClient,
    job: TrainingJob,
    work_root: Path,
    device: str | None,
    images: ImageCache,
    stopped: threading.Event | None = None,
) -> None:
    runs = work_root / RUNS_DIRECTORY
    _prune_stale_runs(runs)
    root = runs / f"{job.run_id}-{job.attempt}"
    root.mkdir(parents=True, exist_ok=True)
    os.utime(root)  # a run ages from its latest claim
    try:
        with keep_lease(
            client.worker,
            lambda: client.renew_lease(job),
            cancelled=stopped.is_set if stopped else None,
        ) as cancelled:
            client.enter_phase(job, "preparing")
            prepare_local_training(job, root)
            bundle = root / "bundle"
            if not bundle.is_dir():
                bundle = _train_bundle(client, job, root, device, images, cancelled)
            if cancelled():
                raise YoloTrainingInterruptedError("training interrupted")
            client.publish_artifact(job, bundle / "weights.pt", bundle / "bundle.json")
            shutil.rmtree(root)
    except (YoloTrainingInterruptedError, LeaseLostError):
        raise
    except Exception as error:
        try:
            client.report_failure(job, str(error) or type(error).__name__)
        except Exception:
            LOGGER.exception("failed to report training run failure")
        raise
    finally:
        if (root / "bundle").is_dir():
            LOGGER.info("Training bundle retained for delivery at %s", root / "bundle")
        elif (root / "run/weights/last.pt").is_file():
            LOGGER.warning(
                "Local training state retained for this worker at %s",
                root,
            )
        else:
            shutil.rmtree(root, ignore_errors=True)
