from importlib.resources import files


def test_packages_share_the_dish_recipe() -> None:
    assert (
        files("vitroflow.photos").joinpath("dish-recipe.json").read_bytes()
        == files("vitroctl.image_geometry").joinpath("dish-recipe.json").read_bytes()
    )
