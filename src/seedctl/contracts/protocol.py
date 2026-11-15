"""The worker protocol revision this package speaks, and the header stating it.

The workbench owns both and generates them into this package beside the wire
schemas. A workbench refuses a worker process that states another revision.
"""

from __future__ import annotations

import json
from importlib.resources import files

_PROTOCOL = json.loads(
    files("seedctl.contracts")
    .joinpath("worker-protocol.json")
    .read_text(encoding="utf-8")
)

WORKER_PROTOCOL: int = _PROTOCOL["revision"]
WORKER_PROTOCOL_HEADER: str = _PROTOCOL["header"]
