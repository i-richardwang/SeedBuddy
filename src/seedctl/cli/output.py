"""JSON output for command-line consumers."""

import json
from typing import Any


def json_output(value: Any) -> None:
    print(json.dumps(value, indent=2))
