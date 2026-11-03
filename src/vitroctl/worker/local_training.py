"""Attempt-local recovery: a worker never fetches another machine's training state."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from vitroctl.detectors.ultralytics.checkpoints import CHECKPOINT_FILES, EPOCH_JOURNAL
from vitroctl.io.files import atomic_directory, write_text_atomically
from vitroctl.training.documents import TrainingClaim

LOCAL_TRAINING_IDENTITY = "training-identity.json"


def attempt_directory(runs: Path, run_id: str, attempt: int) -> Path:
    return runs / f"{run_id}-{attempt}"


def prepare_local_training(claim: TrainingClaim, root: Path) -> None:
    identity = {
        "runId": claim.run_id,
        "snapshotId": claim.dataset_snapshot_id,
        "workerId": claim.worker_id,
        "recipe": claim.recipe.to_dict(),
    }
    checkpoint = claim.checkpoint
    if checkpoint:
        if checkpoint.worker_id != claim.worker_id:
            raise ValueError(
                "Local checkpoint belongs to another worker; restart training"
            )
        source = attempt_directory(root.parent, claim.run_id, checkpoint.attempt)
        try:
            saved = json.loads((source / LOCAL_TRAINING_IDENTITY).read_text())
            if saved != identity:
                raise ValueError(
                    "Local checkpoint identity differs from this training run"
                )
            if not (source / "bundle").is_dir():
                if not all(
                    (source / "run" / name).is_file() for name in CHECKPOINT_FILES
                ):
                    raise ValueError("Local checkpoint files are incomplete")
                journal = [
                    json.loads(line)
                    for line in (source / "run" / EPOCH_JOURNAL)
                    .read_text()
                    .splitlines()
                ]
                if not journal or journal[-1]["epoch"] < checkpoint.epoch:
                    raise ValueError(
                        "Local checkpoint is older than the reported progress"
                    )
            if source != root:
                for name in ("run", "bundle"):
                    if (source / name).is_dir() and not (root / name).exists():
                        with atomic_directory(root / name) as staging:
                            shutil.copytree(source / name, staging, dirs_exist_ok=True)
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise ValueError(
                "Local training state is missing or invalid; explicitly restart training"
            ) from error
    write_text_atomically(
        root / LOCAL_TRAINING_IDENTITY, json.dumps(identity, sort_keys=True) + "\n"
    )
