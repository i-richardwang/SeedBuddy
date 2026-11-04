"""A warm, disposable inference process supervised outside model and network calls."""

from __future__ import annotations

import multiprocessing
import os
import queue
from collections.abc import Callable
from functools import partial
from multiprocessing.connection import Connection
from typing import Any

import httpx

from vitroctl.detectors.contract import DetectionProducer
from vitroctl.worker.images import ImageCache
from vitroctl.worker.inference_protocol import Assignment, InferenceClient
from vitroctl.worker.model_store import ModelStore
from vitroctl.worker.process import read_events, terminate_process_group
from vitroctl.worker.session import WorkerClient, WorkerSession, WorkerSettings


class InferenceExecutionError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _execute(
    connection: Connection, settings: WorkerSettings, session: WorkerSession
) -> None:
    os.setsid()
    worker = WorkerClient(settings.connection, session)
    client = InferenceClient(worker)
    models = ModelStore(client, settings.work_dir, settings.device)
    images = ImageCache(settings.work_dir / "images")
    try:
        while True:
            assignment, deadline = connection.recv()
            try:
                # All potentially blocking loading, transfers and GPU calls live here.
                image = images.fetch(
                    assignment.image, partial(client.download, deadline=deadline)
                )
                detector = models.load(assignment.manifest, deadline)
                producer = DetectionProducer(
                    assignment.version_id, detector.artifact_digest, detector.runtime
                )
                image_path = image.result()
                result = detector.predict(image_path, assignment.image, producer)
                result.require_image(assignment.image)
                connection.send(("result", result.to_dict()))
            except Exception as error:  # noqa: BLE001 - errors cross the process boundary
                code = (
                    "transport"
                    if isinstance(error, (httpx.HTTPError, OSError))
                    else "execution"
                )
                connection.send(
                    (
                        "error",
                        {
                            "code": code,
                            "message": str(error) or type(error).__name__,
                        },
                    )
                )
            finally:
                images.release(assignment.image)
    except (EOFError, BrokenPipeError):
        pass
    finally:
        connection.close()
        images.close()
        models.unload()
        worker.close()


class InferenceProcess:
    def __init__(
        self,
        settings: WorkerSettings,
        session: WorkerSession,
    ) -> None:
        self.settings = settings
        self.session = session
        self._process: Any = None
        self._connection: Connection | None = None

    def _start(self) -> Connection:
        if self._connection is not None:
            return self._connection
        context = multiprocessing.get_context("spawn")
        parent, child = context.Pipe()
        process = context.Process(
            target=_execute,
            args=(child, self.settings, self.session),
            name="vitroflow-inference",
        )
        process.start()
        child.close()
        self._process = process
        self._connection = parent
        return parent

    def run(
        self, assignment: Assignment, deadline: float, check: Callable[[], None]
    ) -> dict[str, object]:
        check()
        connection = self._start()
        replies, reader = read_events(connection, (assignment, deadline))
        try:
            while True:
                check()
                try:
                    kind, value = replies.get(timeout=0.1)
                except queue.Empty:
                    if not self._process.is_alive():
                        raise InferenceExecutionError(
                            "execution",
                            f"Inference process exited with code {self._process.exitcode}",
                        )
                    continue
                check()
                if kind == "result":
                    return value
                if kind == "error":
                    raise InferenceExecutionError(value["code"], value["message"])
                raise InferenceExecutionError(
                    "execution", "Inference process disconnected"
                )
        except BaseException:
            self.close()
            raise
        finally:
            reader.join(timeout=2)

    def close(self) -> None:
        process, connection = self._process, self._connection
        self._process = self._connection = None
        if connection is not None:
            connection.close()
        if process is None:
            return
        terminate_process_group(process)
