"""A disposable trainer process; the worker retains control even if a GPU call hangs."""

from __future__ import annotations

import json
import logging
import multiprocessing
import os
import queue
from collections.abc import Callable, Mapping
from contextlib import suppress
from multiprocessing.connection import Connection
from pathlib import Path
from typing import Any

from seedctl.detectors.ultralytics import (
    EpochReport,
    YoloTrainingInterruptedError,
    YoloTrainingResult,
    train_yolo_detector,
)
from seedctl.worker.process import read_events, terminate_process_group

LOGGER = logging.getLogger(__name__)


def _train(
    connection: Connection, dataset: Path, output: Path, options: dict[str, Any]
) -> None:
    os.setsid()

    def emit(kind: str, value: Any = None) -> None:
        connection.send((kind, value))
        connection.recv()

    try:
        result = train_yolo_detector(
            dataset,
            output,
            **options,
            on_training_start=lambda: emit("training"),
            on_epoch=lambda report: emit("epoch", report),
            on_execution=lambda execution: emit("execution", execution),
            on_validation_start=lambda: emit("validating"),
        )
        connection.send(("result", result))
    except (BrokenPipeError, EOFError):
        pass  # The supervisor revoked execution and closed its end of the pipe.
    except Exception as error:  # noqa: BLE001 - forward trainer failures to the supervising worker
        with suppress(BrokenPipeError, EOFError):
            connection.send(("error", str(error) or type(error).__name__))
    finally:
        connection.close()


def run_training_process(
    dataset: Path,
    output: Path,
    *,
    cancelled: Callable[[], bool],
    on_training_start: Callable[[], None],
    on_epoch: Callable[[EpochReport], None],
    on_validation_start: Callable[[], None],
    parameters: Mapping[str, Any],
    model: str | Path,
    model_digest: str,
    runtime_version: str,
    device: str | None,
    resume_required: bool,
) -> YoloTrainingResult:
    options = {
        "parameters": parameters,
        "model": model,
        "model_digest": model_digest,
        "runtime_version": runtime_version,
        "device": device,
        "resume_required": resume_required,
    }
    context = multiprocessing.get_context("spawn")
    parent, child = context.Pipe()
    process = context.Process(
        target=_train, args=(child, dataset, output, options), name="seedbuddy-trainer"
    )
    process.start()
    child.close()
    events, reader = read_events(parent, None)
    try:
        while True:
            if cancelled():
                raise YoloTrainingInterruptedError("Training execution was revoked")
            try:
                kind, value = events.get(timeout=0.2)
            except queue.Empty:
                if not process.is_alive():
                    raise RuntimeError(f"Trainer exited with code {process.exitcode}")
                continue
            if cancelled():
                raise YoloTrainingInterruptedError("Training execution was revoked")
            if kind == "disconnected":
                raise RuntimeError("Trainer exited without a result")
            if kind == "result":
                return value
            if kind == "error":
                raise RuntimeError(value)
            if kind == "training":
                on_training_start()
            elif kind == "epoch":
                on_epoch(value)
            elif kind == "execution":
                LOGGER.info("Training execution: %s", json.dumps(value, default=str))
            elif kind == "validating":
                on_validation_start()
            else:
                raise RuntimeError(f"Unknown trainer event: {kind}")
            parent.send(None)
    finally:
        parent.close()
        terminate_process_group(process)
        reader.join(timeout=2)
