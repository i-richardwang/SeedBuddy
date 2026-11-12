"""Memory-bounded validation for the pinned Ultralytics detection trainer.

Imported lazily: the base seedctl installation does not require Ultralytics.
"""

from ultralytics.models.yolo.detect.train import DetectionTrainer


class MemoryBoundedDetectionTrainer(DetectionTrainer):
    """Validate at no more than the actual per-device training batch size.

    The framework calls this hook again after automatic OOM batch reduction.
    Its final evaluation reuses the resulting validation loader.
    """

    def get_dataloader(self, dataset_path, batch_size=16, rank=0, mode="train"):
        if mode == "val":
            batch_size = min(batch_size, self.train_loader.batch_size)
        loader = super().get_dataloader(dataset_path, batch_size, rank, mode)
        if mode == "val" and self.validator is not None:
            # OOM recovery rebuilds the pipeline but retains the validator.
            self.validator.dataloader = loader
            self.validator.args.batch = loader.batch_size
        return loader

    def get_validator(self):
        validator = super().get_validator()
        validator.args.batch = self.test_loader.batch_size
        return validator
