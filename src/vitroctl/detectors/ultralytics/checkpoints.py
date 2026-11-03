"""Files maintained by the local Ultralytics trainer for resuming execution."""

EPOCH_JOURNAL = "epochs.jsonl"
LAST_CHECKPOINT = "weights/last.pt"
BEST_CHECKPOINT = "weights/best.pt"
CHECKPOINT_FILES = (LAST_CHECKPOINT, BEST_CHECKPOINT, EPOCH_JOURNAL)
