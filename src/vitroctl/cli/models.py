from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from vitroctl.cli.connection import client, connection_options
from vitroctl.cli.output import json_output
from vitroctl.detectors.ultralytics.detector import (
    UltralyticsDetector,
    YoloInferenceSettings,
)
from vitroctl.detectors.ultralytics.runtime import require_ultralytics_version
from vitroctl.models.bundle import (
    read_bundle,
    validate_bundle,
    weights_descriptor,
    write_bundle,
)


def verify_runtime(document: dict[str, Any], weights: Path) -> None:
    required = document["training"]["runtime"]["version"]
    require_ultralytics_version(required)
    settings = document["inference"]
    detector = UltralyticsDetector(
        weights,
        YoloInferenceSettings(
            settings["confidence"],
            settings["imageSize"],
            settings["maxDetections"],
            settings["endToEnd"],
        ),
        tuple(document["classes"]),
        "cpu",
    )
    detector.validate_weights()


def pack(args: argparse.Namespace) -> int:
    document = json.loads(Path(args.metadata).read_text())
    weights = Path(args.weights)
    document["weights"] = weights_descriptor(weights)
    validate_bundle(document, weights)
    verify_runtime(document, weights)
    print(write_bundle(weights, document, Path(args.output)))
    return 0


def import_bundle(args: argparse.Namespace) -> int:
    document, weights = read_bundle(Path(args.bundle))
    verify_runtime(document, weights)
    json_output(client(args).import_bundle(document, weights, args.model))
    return 0


def add_model_commands(commands: Any) -> None:
    models = commands.add_parser(
        "models", help="Package, register and select immutable model versions"
    )
    sub = models.add_subparsers(dest="model_command", required=True)
    package = sub.add_parser(
        "pack",
        help="Package existing weights with explicit inference and provenance metadata; no training",
    )
    package.add_argument("--weights", required=True)
    package.add_argument(
        "--metadata",
        required=True,
        help="Bundle manifest; weights descriptor is calculated from the file",
    )
    package.add_argument("--output", required=True)
    package.set_defaults(handler=pack)
    upload = sub.add_parser(
        "import", help="Upload and register a candidate version without selecting it"
    )
    upload.add_argument("bundle")
    upload.add_argument("--model", required=True)
    connection_options(upload)
    upload.set_defaults(handler=import_bundle)
    for name, operation in [
        ("list", "list-model-versions"),
        ("use", "use-model-version"),
    ]:
        parser = sub.add_parser(name)
        parser.add_argument("--model", required=True)
        if name == "use":
            parser.add_argument("--version", required=True)
        connection_options(parser)
        parser.set_defaults(handler=remote_model, operation=operation)


def remote_model(args: argparse.Namespace) -> int:
    arguments = {"model": args.model}
    if args.operation == "use-model-version":
        arguments["version"] = args.version
    json_output(client(args).call(args.operation, arguments))
    return 0
