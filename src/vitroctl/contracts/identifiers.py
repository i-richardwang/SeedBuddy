"""Identifier patterns and vocabularies shared by the Server contracts and local tools."""

from __future__ import annotations

import re

DATASET_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")

WORKER_DEVICE = re.compile(r"^(?:cpu|mps|cuda(?::[0-9]+)?)$")
