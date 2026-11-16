"""Build the wheel and the locked runtime description served by a workbench."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = "3.13.14"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    output = parser.parse_args().output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(output)], cwd=ROOT, check=True
    )
    wheels = list(output.glob("seedctl-*.whl"))
    if len(wheels) != 1:
        raise ValueError("The output must hold exactly one seedctl wheel")
    wheel = wheels[0]
    requirements = subprocess.check_output(
        [
            "uv",
            "export",
            "--locked",
            "--no-dev",
            "--extra",
            "yolo",
            "--no-emit-workspace",
            "--no-hashes",
            "--no-header",
        ],
        cwd=ROOT,
        text=True,
    )
    # Read the contract from the built artifact, not the builder's installed package.
    with zipfile.ZipFile(wheel) as archive:
        runtime = ast.parse(archive.read("seedctl/worker/runtime.py"))
    protocol = next(
        ast.literal_eval(node.value)
        for node in runtime.body
        if isinstance(node, ast.Assign)
        and any(
            isinstance(name, ast.Name) and name.id == "HOST_PROTOCOL"
            for name in node.targets
        )
    )
    description = {
        "filename": wheel.name,
        "digest": hashlib.sha256(wheel.read_bytes()).hexdigest(),
        "hostProtocol": protocol,
        "python": PYTHON,
        "requirements": requirements,
    }
    temporary = output / ".runtime.json"
    temporary.write_text(json.dumps(description, indent=2) + "\n")
    temporary.replace(output / "runtime.json")


if __name__ == "__main__":
    main()
