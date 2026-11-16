"""Installed runtime capabilities checked before a host activates it."""

HOST_PROTOCOL = 1


def runtime_description() -> dict[str, int]:
    """Validate execution adapters without loading models or enrolling."""
    from seedctl.detectors.ultralytics.runtime import load_training_trainer, load_yolo

    load_yolo()
    load_training_trainer()
    return {"hostProtocol": HOST_PROTOCOL}
