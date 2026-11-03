import hashlib
import json
from collections.abc import Callable, Sequence
from pathlib import Path
from types import SimpleNamespace
from typing import Any, ClassVar

import pytest
from conftest import PARAMETERS

from vitroctl.detectors.ultralytics import training
from vitroctl.detectors.ultralytics.training import (
    BoxValidationMetrics,
    DetectionLosses,
    EpochReport,
    YoloTrainingInterruptedError,
    best_f1_confidence,
    epoch_report,
    train_yolo_detector,
)

TRAINER = object()


@pytest.fixture(autouse=True)
def fake_training_adapter(monkeypatch):
    monkeypatch.setattr(training, "load_training_trainer", lambda: TRAINER)


def test_nano_recipe_fixes_every_training_argument(recipe) -> None:
    assert recipe["baseModel"]["reference"] == "yolo26n.pt"
    assert recipe["runtime"] == {"framework": "ultralytics", "version": "8.4.131"}
    assert recipe["parameters"] == {
        "epochs": 50,
        "nbs": 64,
        "patience": 20,
        "batch": 4,
        "imgsz": 1536,
        "optimizer": "AdamW",
        "lr0": 0.001,
        "warmup_epochs": 3.0,
        "mosaic": 0.0,
        "mixup": 0.0,
        "copy_paste": 0.0,
        "max_det": 500,
        "seed": 0,
        "deterministic": True,
    }


class _BoxMetrics:
    def __init__(self) -> None:
        self.mp = 0.5
        self.mr = 0.4
        self.map50 = 0.45
        self.map = 0.2
        self.px: Sequence[float] = [0.0, 0.2, 0.4]
        self.f1_curve: Sequence[Sequence[float]] = [[0.1, 0.8, 0.2]]

    def fitness(self) -> float:
        return 0.225


class _Metrics:
    def __init__(self) -> None:
        self.box: BoxValidationMetrics = _BoxMetrics()


def test_best_f1_confidence_reads_the_public_ultralytics_curve() -> None:
    assert best_f1_confidence(_Metrics()) == pytest.approx(0.2)


def test_best_f1_confidence_rejects_a_model_without_validation_signal() -> None:
    metrics = _Metrics()
    metrics.box.f1_curve = [[0.0, 0.0, 0.0]]

    assert best_f1_confidence(metrics) is None


def test_best_f1_confidence_accepts_an_absent_validation_curve() -> None:
    metrics = _Metrics()
    metrics.box.px = []
    metrics.box.f1_curve = []

    assert best_f1_confidence(metrics) is None


def _trainer_after_epoch(
    epoch: int, regression_loss: str = "l1_loss"
) -> SimpleNamespace:
    metrics = _Metrics()
    return SimpleNamespace(
        epoch=epoch - 1,
        args=SimpleNamespace(**PARAMETERS),
        batch_size=4,
        accumulate=16,
        train_loader=SimpleNamespace(batch_size=4),
        test_loader=SimpleNamespace(batch_size=4),
        loss_names=("box_loss", "cls_loss", regression_loss),
        tloss={"box_loss": 1.5, "cls_loss": 2.25, regression_loss: 1.0},
        metrics={
            "val/box_loss": 1.6,
            "val/cls_loss": 2.4,
            f"val/{regression_loss}": 1.1,
        },
        validator=SimpleNamespace(metrics=metrics),
        optimizer=SimpleNamespace(param_groups=[{"lr": 0.001}]),
    )


def test_epoch_report_reads_the_trainer_after_validation() -> None:
    report = epoch_report(_trainer_after_epoch(7))

    assert report == EpochReport(
        epoch=7,
        train=DetectionLosses(box=1.5, classification=2.25, regression=1.0),
        val=DetectionLosses(box=1.6, classification=2.4, regression=1.1),
        precision=0.5,
        recall=0.4,
        map50=0.45,
        map50_to_95=0.2,
        fitness=0.225,
        learning_rate=0.001,
    )
    assert report.to_json()["train"] == {
        "box": 1.5,
        "classification": 2.25,
        "regression": 1.0,
    }
    assert report.to_json()["map50To95"] == 0.2


def test_epoch_report_normalizes_both_ultralytics_regression_losses() -> None:
    assert epoch_report(_trainer_after_epoch(1, "l1_loss")).train.regression == 1.0
    assert epoch_report(_trainer_after_epoch(1, "dfl_loss")).train.regression == 1.0


def test_epoch_report_rejects_non_finite_values() -> None:
    trainer = _trainer_after_epoch(1)
    trainer.validator.metrics.box.map50 = float("nan")

    with pytest.raises(ValueError, match="non-finite mAP50"):
        epoch_report(trainer)


def _base_model(tmp_path: Path) -> tuple[Path, str]:
    model = tmp_path / "base.pt"
    model.write_bytes(b"base-weights")
    return model, hashlib.sha256(model.read_bytes()).hexdigest()


def _dataset(tmp_path: Path) -> Path:
    dataset = tmp_path / "dataset.yaml"
    dataset.write_text("train: images/train\nval: images/val\n")
    return dataset


def test_training_stops_at_a_batch_boundary(tmp_path: Path, monkeypatch) -> None:
    class FakeYolo:
        def __init__(self, _source: str) -> None:
            self.callbacks: dict[str, list[Callable[..., None]]] = {}

        def add_callback(self, event: str, callback) -> None:
            self.callbacks.setdefault(event, []).append(callback)

        def train(self, **_options: object) -> None:
            for callback in self.callbacks["on_train_batch_end"]:
                callback(SimpleNamespace())
            pytest.fail("training must stop at the cancelled batch boundary")

    monkeypatch.setattr(training, "load_yolo", lambda: FakeYolo)
    monkeypatch.setattr(
        "vitroctl.detectors.ultralytics.runtime.version", lambda _: "8.4.131"
    )
    model, digest = _base_model(tmp_path)

    with pytest.raises(YoloTrainingInterruptedError, match="interrupted"):
        train_yolo_detector(
            _dataset(tmp_path),
            tmp_path / "run",
            parameters=PARAMETERS,
            model=model,
            model_digest=digest,
            runtime_version="8.4.131",
            cancelled=lambda: True,
        )


def _checkpointing_yolo(monkeypatch: pytest.MonkeyPatch):
    """A trainer that checkpoints like Ultralytics: every epoch, stripped at the end."""

    class FakeYolo:
        checkpoints: ClassVar[dict[Path, dict[str, Any]]] = {}
        instances: ClassVar[list[Any]] = []
        interrupt_after = 0

        def __init__(self, source: str) -> None:
            self.source = Path(source)
            self.callbacks: dict[str, list[Callable[..., None]]] = {}
            self.train_options: dict[str, object] = {}
            self.trainer = None
            FakeYolo.instances.append(self)

        def add_callback(self, event: str, callback) -> None:
            self.callbacks.setdefault(event, []).append(callback)

        def train(self, **options: object) -> None:
            self.train_options = options
            if options.get("resume"):
                save_dir = self.source.parent.parent
                first = int(FakeYolo.checkpoints[self.source]["epoch"]) + 1
            else:
                save_dir = Path(str(options["project"])) / str(options["name"])
                first = 0
            weights = save_dir / "weights"
            weights.mkdir(parents=True, exist_ok=True)
            last = weights / "last.pt"
            for epoch in range(first, PARAMETERS["epochs"]):
                last.write_bytes(b"checkpoint")
                (weights / "best.pt").write_bytes(b"weights")
                FakeYolo.checkpoints[last] = {
                    "epoch": epoch,
                    "optimizer": {},
                    "train_args": {"data": "old-machine/dataset.yaml"},
                }
                for callback in self.callbacks["on_model_save"]:
                    callback(_trainer_after_epoch(epoch + 1))
                if epoch + 1 == FakeYolo.interrupt_after:
                    raise YoloTrainingInterruptedError("training interrupted")
            FakeYolo.checkpoints[last] = {"epoch": -1, "optimizer": None}
            self.trainer = SimpleNamespace(
                save_dir=save_dir,
                best=weights / "best.pt",
                test_loader=SimpleNamespace(batch_size=4),
                args=SimpleNamespace(imgsz=768, max_det=500, device="mps"),
            )

        def val(self, **_options: object) -> _Metrics:
            return _Metrics()

    monkeypatch.setattr(training, "load_yolo", lambda: FakeYolo)
    monkeypatch.setattr(training, "_load_checkpoint", FakeYolo.checkpoints.__getitem__)
    monkeypatch.setattr(
        training,
        "_save_checkpoint",
        lambda state, path: FakeYolo.checkpoints.__setitem__(path, state),
    )
    monkeypatch.setattr(
        "vitroctl.detectors.ultralytics.runtime.version", lambda _: "8.4.131"
    )
    return FakeYolo


@pytest.mark.parametrize("nbs", [None, 8])
def test_interrupted_training_resumes_after_its_last_completed_epoch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, nbs
) -> None:
    yolo = _checkpointing_yolo(monkeypatch)
    model, digest = _base_model(tmp_path)
    dataset = _dataset(tmp_path)
    output = tmp_path / "run"

    parameters = {**PARAMETERS, **({"nbs": nbs} if nbs is not None else {})}

    def train(reported: list[int]):
        return train_yolo_detector(
            dataset,
            output,
            parameters=parameters,
            model=model,
            model_digest=digest,
            runtime_version="8.4.131",
            device="mps",
            on_epoch=lambda report: reported.append(report.epoch),
        )

    first: list[int] = []
    yolo.interrupt_after = 2
    with pytest.raises(YoloTrainingInterruptedError):
        train(first)
    resumed: list[int] = []
    yolo.interrupt_after = 0
    result = train(resumed)

    assert yolo.instances[0].train_options.get("nbs") == nbs
    assert (
        json.loads(result.summary.read_text())["training"]["parameters"] == parameters
    )
    assert first == [1, 2]
    assert resumed == [1, 2, 3]
    assert yolo.instances[1].source == output / "weights" / "last.pt"
    assert yolo.instances[1].train_options == {
        "trainer": TRAINER,
        "resume": True,
        "data": str(dataset),
        "device": "mps",
    }
    assert result.best_weights == output / "weights" / "best.pt"


def test_finished_training_left_behind_starts_over(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    yolo = _checkpointing_yolo(monkeypatch)
    model, digest = _base_model(tmp_path)
    output = tmp_path / "run"
    options = {
        "parameters": PARAMETERS,
        "model": model,
        "model_digest": digest,
        "runtime_version": "8.4.131",
    }
    train_yolo_detector(_dataset(tmp_path), output, **options)
    (output / "stale").write_text("left by the finished training")
    reported: list[int] = []

    train_yolo_detector(
        _dataset(tmp_path),
        output,
        on_epoch=lambda report: reported.append(report.epoch),
        **options,
    )

    assert reported == [1, 2, 3]
    assert "resume" not in yolo.instances[1].train_options
    assert not (output / "stale").exists()


def test_validation_stops_at_a_batch_boundary(tmp_path: Path, monkeypatch) -> None:
    instances = []

    class FakeYolo:
        def __init__(self, _source: str) -> None:
            self.callbacks = {}
            self.trainer = None
            instances.append(self)

        def add_callback(self, event: str, callback) -> None:
            self.callbacks.setdefault(event, []).append(callback)

        def train(self, **options: object) -> None:
            save_dir = Path(str(options["project"])) / str(options["name"])
            weights = save_dir / "weights"
            weights.mkdir(parents=True)
            (weights / "best.pt").write_bytes(b"weights")
            self.trainer = SimpleNamespace(
                save_dir=save_dir,
                best=weights / "best.pt",
                test_loader=SimpleNamespace(batch_size=4),
                args=SimpleNamespace(imgsz=768, max_det=500, device="cpu"),
            )

        def val(self, **_options: object) -> None:
            for callback in self.callbacks["on_val_batch_end"]:
                callback(SimpleNamespace())
            pytest.fail("validation must stop at the cancelled batch boundary")

    checks = 0

    def cancelled() -> bool:
        nonlocal checks
        checks += 1
        return checks >= 3

    monkeypatch.setattr(training, "load_yolo", lambda: FakeYolo)
    monkeypatch.setattr(
        "vitroctl.detectors.ultralytics.runtime.version", lambda _: "8.4.131"
    )
    model, digest = _base_model(tmp_path)

    with pytest.raises(YoloTrainingInterruptedError, match="interrupted"):
        train_yolo_detector(
            _dataset(tmp_path),
            tmp_path / "run",
            parameters=PARAMETERS,
            model=model,
            model_digest=digest,
            runtime_version="8.4.131",
            cancelled=cancelled,
        )

    assert len(instances) == 2


def test_training_reports_epochs_and_publishes_validated_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    instances = []

    class FakeYolo:
        def __init__(self, source: str) -> None:
            self.source = source
            self.trainer = None
            self.callbacks: dict[str, list[Callable[..., None]]] = {}
            self.train_options: dict[str, object] | None = None
            self.val_options: dict[str, object] | None = None
            instances.append(self)

        def add_callback(self, event: str, callback) -> None:
            self.callbacks.setdefault(event, []).append(callback)

        def train(self, **options: object) -> None:
            self.train_options = options
            save_dir = Path(str(options["project"])) / str(options["name"])
            weights = save_dir / "weights"
            weights.mkdir(parents=True)
            (weights / "best.pt").write_bytes(b"weights")
            for epoch in (1, 2):
                for callback in self.callbacks["on_model_save"]:
                    callback(_trainer_after_epoch(epoch))
            self.trainer = SimpleNamespace(
                save_dir=save_dir,
                best=weights / "best.pt",
                test_loader=SimpleNamespace(batch_size=4),
                args=SimpleNamespace(imgsz=768, max_det=500, device="mps"),
            )

        def val(self, **options: object) -> _Metrics:
            self.val_options = options
            return _Metrics()

    monkeypatch.setattr(training, "load_yolo", lambda: FakeYolo)
    monkeypatch.setattr(
        "vitroctl.detectors.ultralytics.runtime.version", lambda _: "8.4.131"
    )
    model, digest = _base_model(tmp_path)
    dataset = _dataset(tmp_path)
    output = tmp_path / "run"
    reported: list[EpochReport] = []
    phases: list[str] = []

    result = train_yolo_detector(
        dataset,
        output,
        parameters=PARAMETERS,
        model=model,
        model_digest=digest,
        runtime_version="8.4.131",
        device="mps",
        on_training_start=lambda: phases.append("training"),
        on_epoch=reported.append,
        on_validation_start=lambda: phases.append("validating"),
    )

    assert [report.epoch for report in reported] == [1, 2]
    assert phases == ["training", "validating"]
    assert result.best_weights == output / "weights" / "best.pt"
    assert result.confidence == pytest.approx(0.2)
    assert instances[0].train_options == {
        **PARAMETERS,
        "trainer": TRAINER,
        "data": str(dataset),
        "project": str(tmp_path),
        "name": "run",
        "exist_ok": False,
        "device": "mps",
    }
    assert instances[1].val_options["batch"] == 4
    execution = json.loads((output / "execution.json").read_text())
    assert execution["validationBatch"] == 4
    assert execution["accumulate"] == 16
    assert "nbs" not in execution["parameters"]
    assert instances[1].val_options["end2end"] is False
    assert instances[1].val_options["device"] == "mps"
    assert json.loads(result.summary.read_text()) == {
        "schemaVersion": 1,
        "weights": "weights/best.pt",
        "inference": {
            "ready": True,
            "confidence": 0.2,
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
        "training": {
            "baseModel": {"reference": str(model), "digest": digest},
            "parameters": PARAMETERS,
            "runtime": {"framework": "ultralytics", "version": "8.4.131"},
        },
    }


def test_a_requested_resume_never_silently_discards_an_invalid_checkpoint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "vitroctl.detectors.ultralytics.runtime.version", lambda _: "8.4.131"
    )
    dataset = tmp_path / "dataset.yaml"
    dataset.write_text("train: images/train\nval: images/val\n")
    with pytest.raises(ValueError, match="not resumable"):
        training.train_yolo_detector(
            dataset,
            tmp_path / "run",
            parameters=PARAMETERS,
            model_digest="a" * 64,
            runtime_version="8.4.131",
            resume_required=True,
        )
