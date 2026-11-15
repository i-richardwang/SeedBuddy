"""One Worker process: it heartbeats, then serves whatever the workbench holds.

Training takes priority over inference. One supervised execution uses the
accelerator at a time; consecutive inference tasks reuse a warm child process.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable

import httpx

from seedctl.detectors.ultralytics import YoloTrainingInterruptedError
from seedctl.detectors.ultralytics.runtime import release_accelerator
from seedctl.worker.images import ImageCache
from seedctl.worker.inference import WORKER_ERRORS, InferenceRunner
from seedctl.worker.inference_process import InferenceProcess
from seedctl.worker.inference_protocol import InferenceClient
from seedctl.worker.runtime import shutdown_signals
from seedctl.worker.session import WorkerClient, WorkerSession, WorkerSettings
from seedctl.worker.training import TrainingClient, serve_training_claim

LOGGER = logging.getLogger(__name__)


class Worker:
    """
    One session serves training and inference over one connection, and tells
    `on_training` when a training run begins and when it ends.
    """

    def __init__(
        self,
        settings: WorkerSettings,
        *,
        on_training: Callable[[bool], None],
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.on_training = on_training
        self.client = WorkerClient(
            settings.connection,
            WorkerSession.create(),
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
                images = ImageCache(self.settings.work_dir / "images")
                try:
                    self.on_training(True)
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
                    self.on_training(False)
                return True
        return self.runner.run_once(stopped)


def run_worker(
    settings: WorkerSettings,
    *,
    on_ready: Callable[[], None],
    on_training: Callable[[bool], None],
) -> None:
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    worker = Worker(settings, on_training=on_training)
    try:
        with shutdown_signals() as stopped:
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
    finally:
        worker.close()
