from pathlib import Path

import pytest

from seedctl.detectors.traditional.config import DEFAULT_PIPELINE_CONFIG
from seedctl.detectors.traditional.detector import TraditionalDetector
from seedctl.detectors.traditional.identity import pipeline_fingerprint
from seedctl.detectors.traditional.scoring import DEFAULT_MODEL


@pytest.mark.parametrize(
    "dependency",
    [
        "io/image_io.py",
        "image_geometry/dish.py",
        "image_geometry/recipe.py",
        "image_geometry/dish-recipe.json",
        "detectors/traditional/regions.py",
        "detectors/traditional/rendering.py",
    ],
)
def test_runtime_identity_covers_behavior_without_changing_artifact_identity(
    monkeypatch,
    dependency: str,
) -> None:
    pipeline_fingerprint.cache_clear()
    detector = TraditionalDetector(config=DEFAULT_PIPELINE_CONFIG, model=DEFAULT_MODEL)
    before = detector.runtime
    artifact = detector.artifact_digest
    source = Path(__file__).resolve().parents[1] / "src" / "seedctl" / dependency
    read_bytes = Path.read_bytes

    def changed_source(path: Path) -> bytes:
        content = read_bytes(path)
        return (
            content + b"\nchanged dependency\n" if path.resolve() == source else content
        )

    monkeypatch.setattr(Path, "read_bytes", changed_source)
    pipeline_fingerprint.cache_clear()
    try:
        assert detector.runtime.fingerprint != before.fingerprint
        assert detector.artifact_digest == artifact
    finally:
        pipeline_fingerprint.cache_clear()


def test_pipeline_fingerprint_covers_algorithm_module_dependencies() -> None:
    """Moving algorithm code must not remove it from the execution identity."""
    import ast

    from seedctl.detectors.traditional.identity import _PIPELINE_FILES

    root = Path(__file__).resolve().parents[1] / "src"
    package = root / "seedctl" / "detectors" / "traditional"
    covered = {(package / name).resolve() for name in _PIPELINE_FILES}
    frontier = [package / "pipeline.py"]
    visited: set[Path] = set()
    while frontier:
        source = frontier.pop().resolve()
        if source in visited:
            continue
        visited.add(source)
        assert source in covered, f"Execution identity omits {source.relative_to(root)}"
        for node in ast.walk(ast.parse(source.read_text())):
            modules = []
            if isinstance(node, ast.ImportFrom) and node.module:
                modules = [node.module]
            elif isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            for module in modules:
                if module.startswith(
                    ("seedctl.detectors.traditional.", "seedctl.image_geometry.")
                ):
                    frontier.append(
                        root.joinpath(*module.split(".")).with_suffix(".py")
                    )
    assert (root / "seedctl/image_geometry/dish-recipe.json").resolve() in covered


@pytest.mark.parametrize("dependency", ["files.py", "http.py"])
def test_transport_helpers_do_not_change_pipeline_fingerprint(monkeypatch, dependency):
    source = Path(__file__).resolve().parents[1] / "src/seedctl/io" / dependency
    read_bytes = Path.read_bytes
    pipeline_fingerprint.cache_clear()
    before = pipeline_fingerprint()

    def changed_source(path):
        content = read_bytes(path)
        return (
            content + b"\nchanged transport\n" if path.resolve() == source else content
        )

    monkeypatch.setattr(Path, "read_bytes", changed_source)
    pipeline_fingerprint.cache_clear()
    try:
        assert pipeline_fingerprint() == before
    finally:
        pipeline_fingerprint.cache_clear()
