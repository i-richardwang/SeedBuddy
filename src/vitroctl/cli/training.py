"""Training commands use the same recipe, exporter and trainer as a Worker."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from vitroctl.cli.connection import client, connection_options
from vitroctl.cli.output import json_output
from vitroctl.contracts.validation import outbound
from vitroctl.datasets.manifest import load_dataset_manifest, manifest_path
from vitroctl.detectors.ultralytics import export_yolo_dataset, train_yolo_detector
from vitroctl.models.bundle import training_bundle, training_provenance, write_bundle
from vitroctl.training.recipe import TrainingRecipe


def _run(args: argparse.Namespace) -> int:
    if args.local:
        if args.worker:
            raise ValueError("--worker cannot be combined with --local")
        if not args.output:
            raise ValueError("Local training requires --output")
    elif args.resume or args.output or args.device or args.data_root:
        raise ValueError(
            "--resume, --output, --device and --data-root apply only to --local; use training resume for managed tasks"
        )
    spec = json.loads(Path(args.spec).read_text())
    if not isinstance(spec, dict) or set(spec) != {"dataset", "recipe"}:
        raise ValueError("Training spec must contain dataset and recipe")
    if not args.local:
        json_output(
            client(args).call(
                "start-training-run",
                {
                    **spec,
                    "recipe": outbound("training-recipe", spec["recipe"]),
                    "targetWorkerId": args.worker,
                },
            )
        )
        return 0
    recipe = TrainingRecipe.from_document(spec["recipe"])
    output = Path(args.output).resolve()
    data_root = args.data_root or Path("data")
    source = manifest_path(data_root, spec["dataset"])
    manifest = load_dataset_manifest(source)
    identity = {"spec": spec, "dataset": manifest.to_dict()}
    identity_text = json.dumps(identity, sort_keys=True, separators=(",", ":"))
    input_path = output / "input.json"
    if output.exists():
        if not args.resume:
            raise ValueError(
                "Training output exists; use --resume to continue its fixed inputs"
            )
        if not input_path.is_file() or input_path.read_text() != identity_text:
            raise ValueError("Resume inputs differ from the saved recipe or dataset")
    else:
        if args.resume:
            raise ValueError("Cannot resume a missing training directory")
        output.mkdir(parents=True)
        input_path.write_text(identity_text)
    exported_path = output / "dataset"
    if not (exported_path / "dataset.yaml").exists():
        export_yolo_dataset(
            manifest.annotated,
            manifest.classes,
            data_root,
            exported_path,
            seed=recipe.parameters["seed"],
        )
    result = train_yolo_detector(
        exported_path / "dataset.yaml",
        output / "training",
        parameters=recipe.parameters,
        model=recipe.base_model_reference,
        model_digest=recipe.base_model_digest,
        runtime_version=recipe.runtime_version,
        device=args.device,
        resume_required=args.resume,
        on_epoch=lambda epoch: print(json.dumps(epoch.to_dict()), flush=True),
    )
    exported = json.loads((exported_path / "manifest.json").read_text())
    fingerprint = hashlib.sha256(
        json.dumps(
            {"input": identity, "export": exported},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    provenance = training_provenance(
        fingerprint=fingerprint,
        snapshot_id=None,
        dataset_description=f"Pulled dataset {manifest.dataset}; exact input and exported splits in input.json and dataset/manifest.json",
        evaluation_description="Exported validation split",
    )
    document = training_bundle(result, list(manifest.classes), provenance)
    print(write_bundle(result.best_weights, document, output / "bundle"))
    return 0


def _remote(args: argparse.Namespace) -> int:
    if args.training_command == "workers":
        operation, arguments = "list-training-workers", {}
    elif args.training_command == "list":
        operation, arguments = "list-training-runs", {"model": args.model}
    elif args.training_command == "get":
        operation, arguments = "get-training-run", {"runId": args.run}
    else:
        control: dict[str, Any] = {"action": args.training_command}
        if args.training_command == "resume":
            control.update(targetWorkerId=args.worker, restart=args.restart)
        operation, arguments = (
            "control-training-run",
            {
                "dataset": args.dataset,
                "runId": args.run,
                "attempt": args.attempt,
                "control": control,
            },
        )
    json_output(client(args).call(operation, arguments))
    return 0


def add_training_commands(commands: Any) -> None:
    parser = commands.add_parser(
        "training", help="Run local training or control workbench training"
    )
    sub = parser.add_subparsers(dest="training_command", required=True)
    start = sub.add_parser("run")
    start.add_argument(
        "--spec",
        required=True,
        help="JSON with dataset and complete recipe; local mode uses a pulled dataset name, remote mode its workbench id",
    )
    start.add_argument("--local", action="store_true")
    start.add_argument("--worker")
    start.add_argument("--output")
    start.add_argument("--data-root", type=Path)
    start.add_argument("--device")
    start.add_argument("--resume", action="store_true")
    connection_options(start, "experiments")
    start.set_defaults(handler=_run)
    for name in ("workers", "list", "get", "pause", "cancel", "resume"):
        command = sub.add_parser(name)
        if name == "list":
            command.add_argument("--model", required=True)
        elif name != "workers":
            command.add_argument("run")
        if name in {"pause", "cancel", "resume"}:
            command.add_argument("--dataset", required=True)
            command.add_argument("--attempt", type=int, required=True)
        if name == "resume":
            command.add_argument("--worker")
            command.add_argument("--restart", action="store_true")
        connection_options(command, "experiments")
        command.set_defaults(handler=_remote)
