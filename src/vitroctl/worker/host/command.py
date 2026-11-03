from __future__ import annotations

import argparse
import getpass
from typing import Any, Protocol

from vitroctl.worker.host.launchd import (
    require_launchd,
    restart_service,
    start_service,
    stop_service,
)
from vitroctl.worker.host.operations import (
    doctor_profile,
    preflight_profile,
    profile_summary,
    run_profile,
    tail_log,
)
from vitroctl.worker.host.profiles import (
    WorkerProfile,
    list_profiles,
    load_profile,
    profile_exists,
    save_profile,
)


def _setup(args: argparse.Namespace) -> int:
    replacing = profile_exists(args.profile)
    if replacing and not args.force:
        raise FileExistsError(
            f"worker profile already exists: {args.profile}; use --force to replace it"
        )
    require_launchd()
    token = getpass.getpass("Worker token from the workbench: ")
    profile = WorkerProfile(
        server_url=args.server,
        token=token,
        device=args.device,
        poll_seconds=args.poll_seconds,
    )
    for check in preflight_profile(args.profile, profile):
        print(check)
    path = save_profile(args.profile, profile)
    print(f"saved worker profile: {path}")
    if replacing:
        restart_service(args.profile)
    else:
        start_service(args.profile)
    print(f"started {args.profile}")
    return 0


def _list(_args: argparse.Namespace) -> int:
    for name in list_profiles():
        print(profile_summary(name))
    return 0


def _status(args: argparse.Namespace) -> int:
    print(profile_summary(args.profile))
    return 0


def _start(args: argparse.Namespace) -> int:
    for check in doctor_profile(args.profile):
        print(check)
    start_service(args.profile)
    return 0


def _stop(args: argparse.Namespace) -> int:
    stop_service(args.profile)
    return 0


def _restart(args: argparse.Namespace) -> int:
    for check in doctor_profile(args.profile):
        print(check)
    restart_service(args.profile)
    return 0


def _logs(args: argparse.Namespace) -> int:
    load_profile(args.profile)
    tail_log(args.profile, lines=args.lines, follow=args.follow)
    return 0


def _run(args: argparse.Namespace) -> int:
    return run_profile(args.profile)


def _doctor(args: argparse.Namespace) -> int:
    for check in doctor_profile(args.profile):
        print(check)
    return 0


class SubparserCollection(Protocol):
    def add_parser(self, name: str, **kwargs: Any) -> argparse.ArgumentParser: ...


def add_worker_commands(commands: SubparserCollection) -> None:
    worker = commands.add_parser("worker", help="Manage native Worker services")
    worker_commands = worker.add_subparsers(dest="worker_command", required=True)
    setup = worker_commands.add_parser(
        "setup", help="Create and start a Worker profile"
    )
    setup.add_argument("profile")
    setup.add_argument("--server", required=True)
    setup.add_argument("--device")
    setup.add_argument("--poll-seconds", type=float, default=5.0)
    setup.add_argument(
        "--force", action="store_true", help="Replace an existing profile"
    )
    setup.set_defaults(handler=_setup)

    listing = worker_commands.add_parser("list", help="List Worker profiles")
    listing.set_defaults(handler=_list)
    for action, help_text, handler in (
        ("status", "Show local process and service state", _status),
        ("start", "Install and start a Worker service", _start),
        ("stop", "Stop and unload a Worker service", _stop),
        ("restart", "Restart a Worker service", _restart),
        ("doctor", "Validate a profile, runtime, and accelerator", _doctor),
        ("run", "Run a profile in the foreground", _run),
    ):
        command = worker_commands.add_parser(action, help=help_text)
        command.add_argument("profile")
        command.set_defaults(handler=handler)
    logs = worker_commands.add_parser("logs", help="Show Worker logs")
    logs.add_argument("profile")
    logs.add_argument("--lines", type=int, default=100)
    logs.add_argument("--follow", action="store_true")
    logs.set_defaults(handler=_logs)
