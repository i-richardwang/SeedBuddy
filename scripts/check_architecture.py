"""Enforce Python package ownership and reject dependency cycles."""

from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src"
DEPENDENCIES: dict[str, set[str]] = {
    "contracts": set(),
    "io": set(),
    "detector_contracts": {"contracts"},
    "image_geometry": {"contracts"},
    "datasets": {"contracts", "detector_contracts", "io"},
    "training": {"contracts"},
    "traditional": {
        "detector_contracts",
        "contracts",
        "datasets",
        "io",
        "image_geometry",
    },
    "ultralytics": {
        "detector_contracts",
        "contracts",
        "datasets",
        "io",
    },
    "worker": {
        "detector_contracts",
        "models",
        "contracts",
        "training",
        "io",
        "traditional",
        "ultralytics",
    },
    "host": {"worker", "io"},
    "models": {"contracts", "io"},
    "cli": {
        "contracts",
        "models",
        "host",
        "datasets",
        "traditional",
        "ultralytics",
        "io",
        "training",
    },
    "entry": set(),
}


def owner(module: str) -> str:
    if module == "vitroctl":
        return "entry"
    suffix = module.removeprefix("vitroctl.")
    for prefix, name in (
        ("detectors.traditional", "traditional"),
        ("detectors.ultralytics", "ultralytics"),
        ("detectors", "detector_contracts"),
        ("worker.host", "host"),
    ):
        if suffix == prefix or suffix.startswith(prefix + "."):
            return name
    return suffix.split(".")[0]


def imports(
    module: str, source: str, *, package: bool = False, modules: set[str]
) -> set[str]:
    result: set[str] = set()
    base = module if package else module.rsplit(".", 1)[0]
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            result.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            target = node.module or ""
            if node.level:
                parts = base.split(".")[: len(base.split(".")) - node.level + 1]
                target = ".".join(parts + ([target] if target else []))
            result.add(target)
            result.update(
                f"{target}.{alias.name}"
                for alias in node.names
                if f"{target}.{alias.name}" in modules
            )
    return result


def dependency_cycles(graph: dict[str, set[str]]) -> list[str]:
    complete: set[str] = set()
    active: list[str] = []
    errors: list[str] = []

    def visit(node: str) -> None:
        if node in active:
            errors.append(
                "Dependency cycle: "
                + " -> ".join(active[active.index(node) :] + [node])
            )
            return
        if node in complete:
            return
        active.append(node)
        for target in sorted(graph.get(node, set())):
            visit(target)
        active.pop()
        complete.add(node)

    for node in sorted(graph):
        visit(node)
    return errors


def check_architecture(
    sources: dict[str, str], packages: set[str] | None = None
) -> list[str]:
    errors: list[str] = []
    graph: dict[str, set[str]] = {}
    module_graph: dict[str, set[str]] = {}
    for module, source in sorted(sources.items()):
        layer = owner(module)
        if layer not in DEPENDENCIES:
            errors.append(f"{module}: unclassified package")
        for target in sorted(
            imports(
                module,
                source,
                package=module in (packages or set()),
                modules=set(sources),
            )
        ):
            if not target.startswith("vitroctl"):
                if layer in {"contracts", "detector_contracts"} and target.split(".")[
                    0
                ] in {
                    "torch",
                    "cv2",
                    "httpx",
                    "ultralytics",
                }:
                    errors.append(
                        f"{module}: contract must not import runtime {target}"
                    )
                continue
            if target not in sources:
                errors.append(f"{module} -> {target}: unresolved module")
            graph.setdefault(module, set()).add(target)
            destination = owner(target)
            if destination == layer:
                continue
            module_graph.setdefault(layer, set()).add(destination)
            if destination not in DEPENDENCIES.get(layer, set()):
                errors.append(
                    f"{module} -> {target}: dependency direction is not allowed"
                )
    return errors + dependency_cycles(graph) + dependency_cycles(module_graph)


def main() -> int:
    sources: dict[str, str] = {}
    packages: set[str] = set()
    for file in (ROOT / "vitroctl").rglob("*.py"):
        parts = file.relative_to(ROOT).with_suffix("").parts
        module = ".".join(parts[:-1] if parts[-1] == "__init__" else parts)
        if file.name == "__init__.py":
            packages.add(module)
        sources[module] = file.read_text()
    errors = check_architecture(sources, packages)
    if errors:
        print("\n".join(errors))
        return 1
    print(
        "Python architecture: package ownership, dependency direction and cycles checked"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
