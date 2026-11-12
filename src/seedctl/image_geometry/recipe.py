"""One algorithm recipe shared by the server and native image tools."""

import json
import math
from importlib.resources import files

from seedctl.contracts.validation import validate_wire_contract

DISH_RECIPE = json.loads(
    files("seedctl.image_geometry").joinpath("dish-recipe.json").read_text()
)
validate_wire_contract("dish-recipe", DISH_RECIPE, "dish recipe")


def thumbnail_geometry(width: int, height: int) -> tuple[float, int, int]:
    """Positive dimensions use the same half-up rounding in both runtimes."""
    scale = min(1, DISH_RECIPE["thumbnailLongEdge"] / max(width, height))
    return (
        scale,
        max(1, math.floor(width * scale + 0.5)),
        max(1, math.floor(height * scale + 0.5)),
    )
