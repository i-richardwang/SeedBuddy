from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from vitroflow.photos.record import (
    has_confirmations,
    load_record,
    record_of,
    save_record,
)
from vitroflow.photos.review import serve_review
from vitroflow.photos.sorting import sort_photographs


def _sort(args: argparse.Namespace) -> int:
    folder = Path(args.folder).expanduser().resolve()
    if not folder.is_dir():
        raise ValueError(f"{folder} is not a folder")
    output = _unconfirmed(args.output)
    record = record_of(sort_photographs(folder, progress=_progress))
    if output is not None:
        save_record(output, record)
    json.dump(record, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


def _review(args: argparse.Namespace) -> int:
    path = Path(args.file).expanduser()
    if not path.is_file():
        raise ValueError(f"{path} is not a file")
    serve_review(path)
    return 0


def _unconfirmed(output: str | None) -> Path | None:
    """Where the record may be written: a file that holds no confirmation."""
    if output is None:
        return None
    path = Path(output).expanduser()
    if path.is_file() and has_confirmations(load_record(path)):
        raise ValueError(f"{path} already holds confirmations")
    return path


def _progress(line: str) -> None:
    print(line, file=sys.stderr)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vitroflow",
        description="Prepare culture-dish photographs for a VitroFlow workbench.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    photos = commands.add_parser("photos", help="Work with a folder of photographs")
    photo_commands = photos.add_subparsers(dest="photos_command", required=True)
    sorting = photo_commands.add_parser(
        "sort",
        help="Sort the photographs into dishes and suggest one to use for each",
        description=(
            "Sort the photographs in FOLDER by the dish they show, the one whose "
            "seeds are sharpest first, and say whether the seeds in each can be "
            "told apart well enough to count. Prints JSON; files are left "
            "untouched."
        ),
    )
    sorting.add_argument("folder", metavar="FOLDER")
    sorting.add_argument(
        "-o",
        "--output",
        metavar="FILE",
        help=(
            "also write the JSON to FILE; refused when FILE already holds confirmations"
        ),
    )
    sorting.set_defaults(handler=_sort)
    reviewing = photo_commands.add_parser(
        "review",
        help="Confirm which photograph of each dish to use",
        description=(
            "Serve a page to confirm or correct the suggestions in FILE. "
            "Confirmations are written back into FILE. The photographs stay "
            "where they are."
        ),
    )
    reviewing.add_argument("file", metavar="FILE")
    reviewing.set_defaults(handler=_review)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        return args.handler(args)
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
