from __future__ import annotations

import json
import os
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from vitroctl.io.files import atomic_file
from vitroctl.worker.connection import validate_worker_settings

PROFILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
PROFILE_FIELDS = {"server_url", "token", "device", "poll_seconds"}


@dataclass(frozen=True)
class WorkerProfile:
    """The stored form of WorkerSettings, without its resolved work directory."""

    server_url: str
    token: str
    device: str | None = None
    poll_seconds: float = 5.0

    def __post_init__(self) -> None:
        validate_worker_settings(
            self.server_url, self.token, self.poll_seconds, self.device
        )

    @classmethod
    def from_toml(cls, path: Path) -> WorkerProfile:
        document = tomllib.loads(path.read_text(encoding="utf-8"))
        unknown = set(document) - PROFILE_FIELDS
        if unknown:
            raise ValueError(
                f"unknown worker profile fields: {', '.join(sorted(unknown))}"
            )
        return cls(**document)

    def to_toml(self) -> str:
        values: list[tuple[str, object]] = [
            ("server_url", self.server_url),
            ("token", self.token),
        ]
        if self.device is not None:
            values.append(("device", self.device))
        values.append(("poll_seconds", self.poll_seconds))
        return "".join(f"{key} = {json.dumps(value)}\n" for key, value in values)


def worker_home() -> Path:
    configured = os.environ.get("VITROFLOW_HOME")
    return Path(configured).expanduser() if configured else Path.home() / ".vitroflow"


def validate_profile_name(name: str) -> str:
    if not PROFILE_NAME.fullmatch(name):
        raise ValueError(
            "profile name must use letters, numbers, dots, dashes, or underscores"
        )
    return name


def profile_directory(name: str) -> Path:
    return worker_home() / "profiles" / validate_profile_name(name)


def profile_path(name: str) -> Path:
    return profile_directory(name) / "config.toml"


def profile_exists(name: str) -> bool:
    return profile_path(name).is_file()


def load_profile(name: str) -> WorkerProfile:
    path = profile_path(name)
    if not path.is_file():
        raise FileNotFoundError(f"worker profile does not exist: {name}")
    return WorkerProfile.from_toml(path)


def save_profile(name: str, profile: WorkerProfile) -> Path:
    directory = profile_directory(name)
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)
    path = directory / "config.toml"
    with atomic_file(path) as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(profile.to_toml().encode("utf-8"))
    return path


def list_profiles() -> tuple[str, ...]:
    profiles = worker_home() / "profiles"
    if not profiles.is_dir():
        return ()
    return tuple(
        path.parent.name
        for path in sorted(profiles.glob("*/config.toml"))
        if path.is_file()
    )
