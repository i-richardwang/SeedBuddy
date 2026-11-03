"""One Worker process: it heartbeats, then serves whatever the workbench holds.

Training takes priority over inference. One supervised execution uses the
accelerator at a time; consecutive inference tasks reuse a warm child process.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable

import httpx

from vitroctl.detectors.ultralytics import YoloTrainingInterruptedError
from vitroctl.detectors.ultralytics.runtime import release_accelerator
from vitroctl.worker.images import BUDGET_BYTES, ImageCache
from vitroctl.worker.inference import WORKER_ERRORS, InferenceRunner
from vitroctl.worker.inference_process import InferenceProcess
from vitroctl.worker.inference_protocol import InferenceClient
from vitroctl.worker.runtime import shutdown_signals
from vitroctl.worker.session import WorkerClient, WorkerSession, WorkerSettings
from vitroctl.worker.training import TrainingClient, serve_training_claim

LOGGER = logging.getLogger(__name__)


class Worker:
    """One session serves training and inference over one connection."""

    def __init__(
        self,
        settings: WorkerSettings,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        """transport is a test seam; production uses the default transport."""
        self.settings = settings
        self.client = WorkerClient(
            settings.server_url,
            settings.token,
            WorkerSession.create(settings.device),
            transport=transport,
        )
        self.inference = InferenceClient(self.client)
        self.training = TrainingClient(self.client)
        self.runner = InferenceRunner(
            self.inference, InferenceProcess(settings, self.client.session)
        )

    def close(self) -> None:
        try:
            self.runner.close()
        finally:
            self.client.close()

    def serve_once(self, stopped: threading.Event) -> bool:
        """Take at most one task; whether one was taken paces the outer loop."""
        self.client.heartbeat()
        if stopped.is_set():
            return False
        if self.client.session.can_train:
            claim = self.training.claim()
            if claim is not None:
                self.runner.close()
                images = ImageCache(
                    self.settings.work_dir / "images", budget_bytes=BUDGET_BYTES
                )
                try:
                    serve_training_claim(
                        self.training,
                        claim,
                        self.settings.work_dir,
                        self.settings.device,
                        images,
                        stopped=stopped,
                    )
                finally:
                    images.close()
                    release_accelerator()
                return True
        return self.runner.run_once(stopped)


def run_worker(
    settings: WorkerSettings,
    *,
    on_ready: Callable[[], None] | None = None,
) -> int:
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    worker = Worker(settings)
    try:
        with shutdown_signals() as stopped:
            worker.client.heartbeat()
            if on_ready:
                on_ready()
            while not stopped.is_set():
                try:
                    worked = worker.serve_once(stopped)
                except YoloTrainingInterruptedError:
                    LOGGER.info("training interrupted; the lease will be reclaimed")
                    worked = False
                except WORKER_ERRORS as error:
                    LOGGER.error("worker error: %s", error)
                    worked = False
                if not worked:
                    stopped.wait(settings.poll_seconds)
            return 0
    finally:
        worker.close()
