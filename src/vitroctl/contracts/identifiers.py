"""Identifier patterns and vocabularies shared by the Server contracts and local tools."""

from __future__ import annotations

import re

SHORT_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")

DATASET_NAME = SHORT_IDENTIFIER
WORKER_ID = SHORT_IDENTIFIER
WORKER_DEVICE = re.compile(r"^(?:cpu|mps|cuda(?::[0-9]+)?)$")
FINGERPRINT = re.compile(r"^[a-f0-9]{64}$")
LOWER_SNAKE_CASE = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")
CLASS_NAME = LOWER_SNAKE_CASE
