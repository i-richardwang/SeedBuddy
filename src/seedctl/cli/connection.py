"""Connection options shared by workbench commands."""

from __future__ import annotations

import argparse
import os

from seedctl.models.client import WorkbenchClient


def connection(args: argparse.Namespace, scope: str) -> tuple[str, str]:
    server = args.server or os.environ.get("SEEDBUDDY_SERVER_URL")
    token = args.token or os.environ.get("SEEDBUDDY_API_KEY")
    if not server or not token:
        raise ValueError(
            f"Set SEEDBUDDY_SERVER_URL and SEEDBUDDY_API_KEY ({scope} scope), or --server and --token"
        )
    return server, token


def client(args: argparse.Namespace) -> WorkbenchClient:
    return WorkbenchClient(*connection(args, "experiments"))


def connection_options(parser: argparse.ArgumentParser, scope: str) -> None:
    parser.add_argument(
        "--server", help="Workbench URL (default: SEEDBUDDY_SERVER_URL)"
    )
    parser.add_argument(
        "--token", help=f"API key with the {scope} scope (default: SEEDBUDDY_API_KEY)"
    )
