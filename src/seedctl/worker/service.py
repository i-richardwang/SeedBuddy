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
from seedctl.worker.control import WorkerControl
from seedctl.worker.images import ImageCache
from seedctl.worker.inference import WORKER_ERRORS, InferenceRunner
from seedctl.worker.inference_process import InferenceProcess
from seedctl.worker.inference_protocol import InferenceClient
from seedctl.worker.process import ProcessScope
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
        processes: ProcessScope,
    ) -> None:
        self.settings = settings
        self.on_training = on_training
        self.processes = processes
        self.client = WorkerClient(
            settings.connection,
            WorkerSession.create(),
            transport=transport,
        )
        self.inference = InferenceClient(self.client)
        self.training = TrainingClient(self.client)
        self.runner = InferenceRunner(
            self.inference,
            InferenceProcess(settings, self.client.session, self.processes),
        )

    def close(self) -> None:
        try:
            self.runner.close()
        finally:
            self.client.close()

    def serve_once(
        self, stopped: threading.Event, draining: threading.Event | None = None
    ) -> bool:
        """Take at most one task; whether one was taken paces the outer loop."""
        self.client.heartbeat()
        if stopped.is_set() or (draining is not None and draining.is_set()):
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
                        processes=self.processes,
                    )
                finally:
                    images.close()
                    release_accelerator()
                    self.on_training(False)
                return True
        if draining is not None and draining.is_set():
            return False
        return self.runner.run_once(stopped)


def run_worker(
    settings: WorkerSettings,
    control: WorkerControl,
    *,
    on_ready: Callable[[], None],
    on_training: Callable[[bool], None],
) -> None:
    """Serve until admission closes; only an explicit stop interrupts execution."""
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    worker = Worker(settings, on_training=on_training, processes=control.processes)
    try:
        on_ready()
        while not control.draining.is_set():
            try:
                worked = worker.serve_once(control.stopped, control.draining)
            except YoloTrainingInterruptedError:
                LOGGER.info("training interrupted; the lease will be reclaimed")
                worked = False
            except WORKER_ERRORS as error:
                LOGGER.error("worker error: %s", error)
                worked = False
            if not worked:
                control.draining.wait(settings.poll_seconds)
    finally:
        worker.close()
