from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from vitroctl.detectors.traditional.candidates import FEATURE_NAMES, CandidateEvidence
from vitroctl.io.files import write_text_atomically


def _number(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Candidate model {field} must be numeric")
    return float(value)


def _number_array(value: object, field: str) -> tuple[float, ...]:
    if not isinstance(value, list):
        raise ValueError(f"Candidate model {field} must be an array")
    return tuple(_number(item, field) for item in value)


@dataclass(frozen=True)
class CandidateModel:
    name: str
    feature_names: tuple[str, ...]
    means: tuple[float, ...]
    scales: tuple[float, ...]
    weights: tuple[float, ...]
    bias: float
    calibration_centers: tuple[tuple[float, ...], ...] = ()
    calibration_weights: tuple[float, ...] = ()
    calibration_bandwidth: float = 1.0

    def __post_init__(self) -> None:
        size = len(self.feature_names)
        if not self.name:
            raise ValueError("Candidate model name cannot be empty")
        if self.feature_names != FEATURE_NAMES:
            raise ValueError("Candidate model feature schema does not match runtime")
        if not (len(self.means) == len(self.scales) == len(self.weights) == size):
            raise ValueError("Candidate model vectors must match the feature schema")
        values = (*self.means, *self.scales, *self.weights, self.bias)
        if not all(np.isfinite(value) for value in values):
            raise ValueError("Candidate model parameters must be finite")
        if any(scale <= 0 for scale in self.scales):
            raise ValueError("Candidate model scales must be positive")
        if len(self.calibration_centers) != len(self.calibration_weights):
            raise ValueError("Calibration centers and weights must have equal length")
        if any(len(center) != size for center in self.calibration_centers):
            raise ValueError("Calibration centers must match the feature schema")
        if self.calibration_bandwidth <= 0:
            raise ValueError("Calibration bandwidth must be positive")
        calibration_values = (
            *(value for center in self.calibration_centers for value in center),
            *self.calibration_weights,
            self.calibration_bandwidth,
        )
        if not all(np.isfinite(value) for value in calibration_values):
            raise ValueError("Candidate model calibration must be finite")

    def score(self, evidence: list[CandidateEvidence]) -> np.ndarray:
        if not evidence:
            return np.empty(0, dtype=np.float64)
        matrix = np.vstack([item.to_array() for item in evidence])
        return self.score_features(matrix)

    def score_features(self, matrix: np.ndarray) -> np.ndarray:
        if matrix.ndim != 2 or matrix.shape[1] != len(self.feature_names):
            raise ValueError("Candidate matrix does not match the feature schema")
        normalized = np.clip(
            (matrix - np.asarray(self.means)) / np.asarray(self.scales),
            -6.0,
            6.0,
        )
        logits = normalized @ np.asarray(self.weights) + self.bias
        if self.calibration_centers:
            centers = np.asarray(self.calibration_centers)
            similarity = radial_kernel(normalized, centers, self.calibration_bandwidth)
            logits += similarity @ np.asarray(self.calibration_weights)
        logits = np.clip(logits, -30.0, 30.0)
        return 1.0 / (1.0 + np.exp(-logits))

    @property
    def fingerprint(self) -> str:
        payload = {
            "feature_names": self.feature_names,
            "means": self.means,
            "scales": self.scales,
            "weights": self.weights,
            "bias": self.bias,
            "calibration_centers": self.calibration_centers,
            "calibration_weights": self.calibration_weights,
            "calibration_bandwidth": self.calibration_bandwidth,
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "fingerprint": self.fingerprint,
            "feature_names": list(self.feature_names),
            "means": list(self.means),
            "scales": list(self.scales),
            "weights": list(self.weights),
            "bias": self.bias,
            "calibration_centers": [
                list(center) for center in self.calibration_centers
            ],
            "calibration_weights": list(self.calibration_weights),
            "calibration_bandwidth": self.calibration_bandwidth,
        }

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> CandidateModel:
        fields = {
            "name",
            "fingerprint",
            "feature_names",
            "means",
            "scales",
            "weights",
            "bias",
            "calibration_centers",
            "calibration_weights",
            "calibration_bandwidth",
        }
        if set(data) != fields:
            raise ValueError("Candidate model fields do not match the schema")
        if not isinstance(data["name"], str):
            raise ValueError("Candidate model name must be a string")
        if not isinstance(data["fingerprint"], str):
            raise ValueError("Candidate model fingerprint must be a string")
        feature_names = data["feature_names"]
        if not isinstance(feature_names, list) or not all(
            isinstance(value, str) for value in feature_names
        ):
            raise ValueError(
                "Candidate model feature_names must be an array of strings"
            )
        calibration_centers = data["calibration_centers"]
        if not isinstance(calibration_centers, list) or any(
            not isinstance(center, list) for center in calibration_centers
        ):
            raise ValueError("Candidate model calibration centers must be arrays")
        model = cls(
            name=data["name"],
            feature_names=tuple(feature_names),
            means=_number_array(data["means"], "means"),
            scales=_number_array(data["scales"], "scales"),
            weights=_number_array(data["weights"], "weights"),
            bias=_number(data["bias"], "bias"),
            calibration_centers=tuple(
                _number_array(center, "calibration_centers")
                for center in calibration_centers
            ),
            calibration_weights=_number_array(
                data["calibration_weights"], "calibration_weights"
            ),
            calibration_bandwidth=_number(
                data["calibration_bandwidth"], "calibration_bandwidth"
            ),
        )
        if data["fingerprint"] != model.fingerprint:
            raise ValueError("Candidate model fingerprint does not match its contents")
        return model


_MODEL_PATH = Path(__file__).with_name("candidate_model.json")


def load_candidate_model(path: str | Path) -> CandidateModel:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Candidate model must be a JSON object")
    return CandidateModel.from_dict(payload)


def write_candidate_model(model: CandidateModel, path: str | Path) -> None:
    write_text_atomically(path, json.dumps(model.to_dict(), indent=2) + "\n")


DEFAULT_MODEL = load_candidate_model(_MODEL_PATH)


def radial_kernel(
    samples: np.ndarray, centers: np.ndarray, bandwidth: float
) -> np.ndarray:
    squared_distance = np.maximum(
        np.sum(np.square(samples), axis=1)[:, None]
        + np.sum(np.square(centers), axis=1)[None, :]
        - 2.0 * samples @ centers.T,
        0.0,
    )
    return np.exp(-squared_distance / (2.0 * bandwidth**2))
