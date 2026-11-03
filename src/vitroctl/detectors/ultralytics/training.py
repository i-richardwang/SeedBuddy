from __future__ import annotations

import hashlib
import json
import shutil
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from vitroctl.contracts.validation import validate_wire_contract
from vitroctl.detectors.ultralytics.checkpoints import EPOCH_JOURNAL, LAST_CHECKPOINT
from vitroctl.detectors.ultralytics.runtime import (
    load_training_trainer,
    load_yolo,
    require_ultralytics_version,
)
from vitroctl.io.files import file_digest, write_text_atomically


class BoxValidationMetrics(Protocol):
    mp: float
    mr: float
    map50: float
    map: float
    f1_curve: Sequence[Sequence[float]]
    px: Sequence[float]

    def fitness(self) -> float: ...


class ValidationMetrics(Protocol):
    box: BoxValidationMetrics


@dataclass(frozen=True)
class DetectionLosses:
    """Framework-neutral detection losses exposed by the training protocol."""

    box: float
    classification: float
    regression: float

    def to_dict(self) -> dict[str, float]:
        return {
            "box": self.box,
            "classification": self.classification,
            "regression": self.regression,
        }


@dataclass(frozen=True)
class EpochReport:
    """What Ultralytics knows after one epoch's validation pass."""

    epoch: int
    train: DetectionLosses
    val: DetectionLosses
    precision: float
    recall: float
    map50: float
    map50_to_95: float
    fitness: float
    learning_rate: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "epoch": self.epoch,
            "train": self.train.to_dict(),
            "val": self.val.to_dict(),
            "precision": self.precision,
            "recall": self.recall,
            "map50": self.map50,
            "map50To95": self.map50_to_95,
            "fitness": self.fitness,
            "learningRate": self.learning_rate,
        }

    @classmethod
    def from_document(
        cls, document: Mapping[str, Any], context: str = "epoch report"
    ) -> EpochReport:
        validate_wire_contract("training-epoch-report", document, context)
        return cls.decode(document, context)

    @classmethod
    def decode(cls, document: Mapping[str, Any], context: str) -> EpochReport:
        return cls(
            epoch=int(document["epoch"]),
            train=DetectionLosses(**document["train"]),
            val=DetectionLosses(**document["val"]),
            precision=float(document["precision"]),
            recall=float(document["recall"]),
            map50=float(document["map50"]),
            map50_to_95=float(document["map50To95"]),
            fitness=float(document["fitness"]),
            learning_rate=float(document["learningRate"]),
        )


@dataclass(frozen=True)
class YoloTrainingResult:
    best_weights: Path
    summary: Path
    context: dict[str, Any]


class YoloTrainingInterruptedError(RuntimeError):
    pass


def _smooth_curve(values: np.ndarray, fraction: float) -> np.ndarray:
    """Apply the box filter Ultralytics uses when selecting max-F1."""
    width = round(len(values) * fraction * 2) // 2 + 1
    padding = np.ones(width // 2)
    padded = np.concatenate((padding * values[0], values, padding * values[-1]))
    return np.convolve(padded, np.ones(width) / width, mode="valid")


def best_f1_confidence(metrics: ValidationMetrics) -> float | None:
    """Select inference confidence from Ultralytics' public detection curves."""
    confidence = np.asarray(metrics.box.px, dtype=float)
    f1_curve = np.asarray(metrics.box.f1_curve, dtype=float)
    if confidence.size == 0 or f1_curve.size == 0:
        return None
    if (
        confidence.ndim != 1
        or f1_curve.ndim != 2
        or f1_curve.shape[1:] != confidence.shape
    ):
        raise ValueError("Invalid F1-confidence curve returned by Ultralytics")
    if not np.isfinite(confidence).all() or not np.isfinite(f1_curve).all():
        raise ValueError("Non-finite F1-confidence curve returned by Ultralytics")
    mean_f1 = _smooth_curve(f1_curve.mean(axis=0), 0.1)
    index = int(mean_f1.argmax())
    if mean_f1[index] <= 0:
        return None
    value = float(confidence[index])
    if not 0.0 <= value <= 1.0:
        raise ValueError("Confidence returned by Ultralytics is outside [0, 1]")
    return value


def _finite(value: Any, name: str) -> float:
    number = float(value)
    if not np.isfinite(number):
        raise ValueError(f"Ultralytics reported a non-finite {name}")
    return number


def _losses(
    values: Mapping[str, Any], loss_names: Sequence[str], prefix: str
) -> DetectionLosses:
    names = set(loss_names)
    regression_names = names.intersection({"dfl_loss", "l1_loss"})
    if names - {"box_loss", "cls_loss", "dfl_loss", "l1_loss"} or (
        names.intersection({"box_loss", "cls_loss"}) != {"box_loss", "cls_loss"}
        or len(regression_names) != 1
        or len(names) != 3
    ):
        raise ValueError(
            "Ultralytics returned unsupported detection loss components: "
            + ", ".join(sorted(names))
        )
    regression_name = next(iter(regression_names))
    return DetectionLosses(
        box=_finite(values[f"{prefix}box_loss"], f"{prefix}box loss"),
        classification=_finite(
            values[f"{prefix}cls_loss"], f"{prefix}classification loss"
        ),
        regression=_finite(
            values[f"{prefix}{regression_name}"], f"{prefix}regression loss"
        ),
    )


def _validation_summary(metrics: ValidationMetrics) -> dict[str, float]:
    box = metrics.box
    return {
        "precision": _finite(box.mp, "precision"),
        "recall": _finite(box.mr, "recall"),
        "map50": _finite(box.map50, "mAP50"),
        "map50To95": _finite(box.map, "mAP50-95"),
        "fitness": _finite(box.fitness(), "fitness"),
    }


def epoch_report(trainer: Any) -> EpochReport:
    """Read one finished epoch from an Ultralytics trainer after validation."""
    metrics = trainer.validator.metrics
    validation = _validation_summary(metrics)
    loss_names = tuple(trainer.loss_names)
    return EpochReport(
        epoch=int(trainer.epoch) + 1,
        train=_losses(trainer.tloss, loss_names, ""),
        val=_losses(trainer.metrics, loss_names, "val/"),
        precision=validation["precision"],
        recall=validation["recall"],
        map50=validation["map50"],
        map50_to_95=validation["map50To95"],
        fitness=validation["fitness"],
        learning_rate=_finite(trainer.optimizer.param_groups[0]["lr"], "learning rate"),
    )


def _model_source(model: str | Path, weights_dir: Path) -> Path:
    source = Path(model)
    if source.parent == Path() and not source.exists():
        weights_dir.mkdir(parents=True, exist_ok=True)
        source = weights_dir / source.name
    return source


def _load_checkpoint(path: Path) -> Mapping[str, Any]:
    from ultralytics.utils.patches import torch_load

    return torch_load(path, map_location="cpu")


def _save_checkpoint(state: dict[str, Any], path: Path) -> None:
    import torch

    torch.save(state, path)


def _completed_epochs(output: Path, epochs: int) -> tuple[EpochReport, ...]:
    """The epochs an interrupted training in ``output`` resumes after.

    Ultralytics saves ``last.pt`` with its optimizer after every epoch and strips
    the optimizer once training ends; the journal holds the report of each epoch
    the checkpoint covers. A finished, torn, or partly journaled training has
    no resumable epochs. The caller decides whether a fresh start is allowed.
    """
    checkpoint = output / LAST_CHECKPOINT
    journal = output / EPOCH_JOURNAL
    if not checkpoint.is_file() or not journal.is_file():
        return ()
    try:
        state = _load_checkpoint(checkpoint)
        completed = int(state["epoch"]) + 1
        reports = tuple(
            EpochReport.from_document(json.loads(line))
            for line in journal.read_text(encoding="utf-8").splitlines()
        )
    except Exception:  # noqa: BLE001 - unreadable state is not resumable
        return ()
    if state.get("optimizer") is None or not 0 < completed < epochs:
        return ()
    if [report.epoch for report in reports] != list(range(1, completed + 1)):
        return ()
    return reports


def train_yolo_detector(
    dataset: str | Path,
    output_dir: str | Path,
    *,
    parameters: Mapping[str, Any],
    model: str | Path,
    model_digest: str,
    runtime_version: str,
    device: str | None = None,
    on_training_start: Callable[[], None] | None = None,
    on_epoch: Callable[[EpochReport], None] | None = None,
    on_validation_start: Callable[[], None] | None = None,
    resume_required: bool = False,
    on_execution: Callable[[dict[str, Any]], None] | None = None,
) -> YoloTrainingResult:
    """Fine-tune, validate, and publish inference calibration for a YOLO detector.

    `parameters` are the Ultralytics training arguments the run fixes; they are
    recorded verbatim in the published summary. `output_dir` belongs to this
    training: one interrupted there resumes after its last completed epoch, and
    `on_epoch` still sees every epoch from the first.
    """
    fixed_parameters = dict(parameters)
    data_path = Path(dataset).resolve()
    if not data_path.is_file():
        raise FileNotFoundError(data_path)
    require_ultralytics_version(runtime_version)
    output = Path(output_dir).resolve()
    completed = _completed_epochs(output, int(fixed_parameters["epochs"]))
    if resume_required and not completed:
        raise ValueError(
            "Checkpoint is not resumable; explicitly restart training to discard it"
        )
    if not completed and output.exists():
        shutil.rmtree(output)
    output.parent.mkdir(parents=True, exist_ok=True)

    yolo = load_yolo()
    train_options: dict[str, object]
    if completed:
        # The checkpoint carries the arguments the run started with.
        checkpoint_path = output / LAST_CHECKPOINT
        state = dict(_load_checkpoint(checkpoint_path))
        state["train_args"] = {
            **state["train_args"],
            "data": str(data_path),
            "project": str(output.parent),
            "name": output.name,
            "save_dir": str(output),
            "exist_ok": True,
        }
        _save_checkpoint(state, checkpoint_path)
        trainer_model = yolo(str(checkpoint_path))
        train_options = {"resume": True, "data": str(data_path)}
    else:
        model_source = _model_source(model, output.parent / "weights")
        trainer_model = yolo(str(model_source))
        if not model_source.is_file() or file_digest(model_source) != model_digest:
            raise ValueError("Training base model failed digest verification")
        train_options = {
            **fixed_parameters,
            "data": str(data_path),
            "project": str(output.parent),
            "name": output.name,
            "exist_ok": False,
        }
    if device is not None:
        train_options["device"] = device

    journal = output / EPOCH_JOURNAL

    last_execution: dict[str, Any] | None = None

    def record_execution(trainer: Any) -> None:
        nonlocal last_execution
        # Keep requested recipe identity intact. Record actual runtime settings
        # separately, including OOM reductions and the pinned runtime defaults.
        execution = {
            "parameters": dict(vars(trainer.args)),
            "batch": trainer.batch_size,
            "trainBatchPerDevice": trainer.train_loader.batch_size,
            "validationBatch": trainer.test_loader.batch_size,
            "accumulate": trainer.accumulate,
        }
        if execution == last_execution:
            return
        last_execution = execution
        write_text_atomically(
            output / "execution.json",
            json.dumps(execution, indent=2, default=str) + "\n",
        )
        if on_execution:
            on_execution(execution)

    def record_epoch(trainer: Any) -> None:
        report = epoch_report(trainer)
        with journal.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(report.to_dict()) + "\n")
        if on_epoch:
            on_epoch(report)

    trainer_model.add_callback("on_train_start", record_execution)
    trainer_model.add_callback("on_model_save", record_execution)
    trainer_model.add_callback("on_model_save", record_epoch)
    if on_training_start:
        on_training_start()
    if on_epoch:
        for report in completed:
            on_epoch(report)
    trainer_model.train(trainer=load_training_trainer(), **train_options)
    trainer = trainer_model.trainer
    save_dir = Path(trainer.save_dir)
    best_weights = Path(trainer.best)
    if not best_weights.is_file():
        raise RuntimeError(f"Training did not produce {best_weights}")

    trained_args = trainer.args
    context = {
        "effectiveParameters": {
            key: value
            for key, value in vars(trained_args).items()
            if value is None or isinstance(value, (str, int, float, bool))
        },
        "codeRevision": "sha256:"
        + hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    write_text_atomically(
        save_dir / "training-context.json", json.dumps(context, indent=2) + "\n"
    )
    validator_model = yolo(str(best_weights))
    if on_validation_start:
        on_validation_start()
    metrics = validator_model.val(
        data=str(data_path),
        batch=trainer.test_loader.batch_size,
        imgsz=trained_args.imgsz,
        max_det=trained_args.max_det,
        end2end=False,
        device=trained_args.device,
        project=str(save_dir),
        name="validation-one-to-many",
        exist_ok=False,
    )
    confidence = best_f1_confidence(metrics)
    metric_values = _validation_summary(metrics)

    summary_path = save_dir / "inference.json"
    summary = {
        "inference": {
            "ready": confidence is not None,
            "confidence": confidence,
            "imageSize": trained_args.imgsz,
            "maxDetections": trained_args.max_det,
            "endToEnd": False,
        },
        "validation": metric_values,
        "training": {
            "baseModel": {
                "reference": str(model),
                "digest": model_digest,
            },
            "parameters": fixed_parameters,
            "runtime": {
                "framework": "ultralytics",
                "version": runtime_version,
            },
        },
    }
    write_text_atomically(summary_path, json.dumps(summary, indent=2) + "\n")
    return YoloTrainingResult(best_weights, summary_path, context)
