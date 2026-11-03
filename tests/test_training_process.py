from __future__ import annotations

import multiprocessing
import time
from pathlib import Path

import pytest

from vitroctl.detectors.ultralytics import YoloTrainingInterruptedError
from vitroctl.worker import training_process


def _hung_trainer(*_args, **_kwargs):
    while True:
        time.sleep(0.05)


def _broken_trainer(*_args, **_kwargs):
    raise ValueError("invalid checkpoint")


@pytest.mark.parametrize(
    "trainer,interrupted", [(_hung_trainer, True), (_broken_trainer, False)]
)
def test_supervisor_terminates_an_unresponsive_trainer_and_surfaces_failures(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, trainer, interrupted: bool
) -> None:
    context = multiprocessing.get_context("fork")
    monkeypatch.setattr(
        training_process.multiprocessing, "get_context", lambda _: context
    )
    monkeypatch.setattr(training_process, "train_yolo_detector", trainer)
    before = {child.pid for child in multiprocessing.active_children()}
    deadline = time.monotonic() + 0.3
    with pytest.raises(
        YoloTrainingInterruptedError if interrupted else RuntimeError,
        match="revoked" if interrupted else "invalid checkpoint",
    ):
        training_process.run_training_process(
            tmp_path / "dataset.yaml",
            tmp_path / "run",
            cancelled=lambda: interrupted and time.monotonic() >= deadline,
            on_training_start=lambda: None,
            on_epoch=lambda _: None,
            on_validation_start=lambda: None,
        )
    assert {child.pid for child in multiprocessing.active_children()} == before


def _trainer_with_surviving_child(_dataset, output, **_options):
    import subprocess
    import sys

    output.mkdir(parents=True)
    heartbeat = output / "child-heartbeat"
    subprocess.Popen(
        [
            sys.executable,
            "-c",
            """import pathlib, sys, time
path = pathlib.Path(sys.argv[1])
while True:
    with path.open("ab") as stream:
        stream.write(b".")
    time.sleep(0.01)
""",
            str(heartbeat),
        ]
    )
    deadline = time.monotonic() + 2
    while not heartbeat.exists():
        if time.monotonic() > deadline:
            raise RuntimeError("child did not start")
        time.sleep(0.01)


def test_supervisor_cleans_descendants_after_the_trainer_has_exited(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = multiprocessing.get_context("fork")
    monkeypatch.setattr(
        training_process.multiprocessing, "get_context", lambda _: context
    )
    monkeypatch.setattr(
        training_process, "train_yolo_detector", _trainer_with_surviving_child
    )
    output = tmp_path / "run"
    training_process.run_training_process(
        tmp_path / "dataset.yaml",
        output,
        cancelled=lambda: False,
        on_training_start=lambda: None,
        on_epoch=lambda _: None,
        on_validation_start=lambda: None,
    )
    heartbeat = output / "child-heartbeat"
    size = heartbeat.stat().st_size
    time.sleep(0.1)
    assert heartbeat.stat().st_size == size


def _diagnostic_trainer(_dataset, _output, *, on_execution, **_options):
    on_execution({"batch": 1, "validationBatch": 1, "accumulate": 8})


def test_supervisor_persists_child_execution_diagnostics_in_worker_log(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog
) -> None:
    context = multiprocessing.get_context("fork")
    monkeypatch.setattr(
        training_process.multiprocessing, "get_context", lambda _: context
    )
    monkeypatch.setattr(training_process, "train_yolo_detector", _diagnostic_trainer)
    with caplog.at_level("INFO", logger=training_process.__name__):
        training_process.run_training_process(
            tmp_path / "dataset.yaml",
            tmp_path / "run",
            cancelled=lambda: False,
            on_training_start=lambda: None,
            on_epoch=lambda _: None,
            on_validation_start=lambda: None,
        )
    assert '"validationBatch": 1' in caplog.text
    assert '"accumulate": 8' in caplog.text


def _partial_message(connection, _dataset, _output, _options):
    import os
    import struct

    os.setsid()
    os.write(connection.fileno(), struct.pack("!i", 1024) + b"partial")
    time.sleep(2)


def test_partial_event_does_not_block_training_cancellation(tmp_path, monkeypatch):
    context = multiprocessing.get_context("fork")
    monkeypatch.setattr(
        training_process.multiprocessing, "get_context", lambda _: context
    )
    monkeypatch.setattr(training_process, "_train", _partial_message)
    before = {child.pid for child in multiprocessing.active_children()}
    started = time.monotonic()
    with pytest.raises(YoloTrainingInterruptedError, match="revoked"):
        training_process.run_training_process(
            tmp_path / "dataset.yaml",
            tmp_path / "run",
            cancelled=lambda: time.monotonic() - started > 0.2,
            on_training_start=lambda: None,
            on_epoch=lambda _: None,
            on_validation_start=lambda: None,
        )
    assert {child.pid for child in multiprocessing.active_children()} == before
