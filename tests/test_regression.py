import hashlib
import json
import os
from pathlib import Path

import pytest

from vitroctl.detectors.traditional.config import DEFAULT_PIPELINE_CONFIG
from vitroctl.detectors.traditional.pipeline import count_seeds
from vitroctl.detectors.traditional.scoring import DEFAULT_MODEL

REFERENCE_MANIFEST = Path(__file__).parent / "fixtures" / "reference-images.json"


@pytest.mark.reference
def test_reference_image_counts() -> None:
    configured = os.environ.get("VITROFLOW_REFERENCE_IMAGE_DIR")
    assert configured, (
        "Set VITROFLOW_REFERENCE_IMAGE_DIR or run "
        "`make check-reference REFERENCE_IMAGE_DIR=/path/to/images`"
    )
    image_dir = Path(configured).resolve()
    document = json.loads(REFERENCE_MANIFEST.read_text(encoding="utf-8"))
    cases = document["images"]
    assert isinstance(cases, list) and cases

    for case in cases:
        image_path = image_dir / case["file"]
        assert image_path.is_file(), f"reference image not found: {case['file']}"
        digest = hashlib.sha256(image_path.read_bytes()).hexdigest()
        assert digest == case["sha256"], f"reference image changed: {case['file']}"

        result = count_seeds(
            image_path, config=DEFAULT_PIPELINE_CONFIG, model=DEFAULT_MODEL
        )

        assert result.count == case["expectedCount"], image_path.name
        assert result.quality.status == "ok", image_path.name
