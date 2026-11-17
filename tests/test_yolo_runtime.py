import pytest

from seedctl.detectors.ultralytics import runtime

pytest.importorskip("ultralytics")


def test_loading_the_runtime_bounds_metal_memory(monkeypatch) -> None:
    environ: dict[str, str] = {}
    monkeypatch.setattr(runtime.os, "environ", environ)

    runtime.load_yolo()

    assert environ == runtime.MPS_MEMORY_BOUNDS


def test_a_bound_the_operator_set_replaces_both(monkeypatch) -> None:
    environ = {"PYTORCH_MPS_HIGH_WATERMARK_RATIO": "0.5"}
    monkeypatch.setattr(runtime.os, "environ", environ)

    runtime.load_yolo()

    assert environ == {"PYTORCH_MPS_HIGH_WATERMARK_RATIO": "0.5"}
