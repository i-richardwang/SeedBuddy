import { Play } from "lucide-react";

import type { DatasetTrainingReadiness } from "../../domain/datasets/read-model";
import { MIN_SNAPSHOT_IMAGES } from "../../domain/training/schema";
import { m } from "../../paraglide/messages";
import { Button } from "../../ui/kit/Button";
import { Tooltip } from "../../ui/kit/Tooltip";

/** Opens the training dialog, or says in a tooltip why a run cannot start. */
export function TrainButton({
  reviewed,
  training,
  onClick,
}: {
  reviewed: number;
  training: DatasetTrainingReadiness;
  onClick: () => void;
}) {
  const refusal = trainRefusal({ reviewed, training });
  return (
    <Tooltip title={refusal}>
      <Button
        type="primary"
        icon={Play}
        disabled={refusal !== null}
        onClick={onClick}
      >
        {m.training_button()}
      </Button>
    </Tooltip>
  );
}

/** Why a new run cannot start now, or null when it can. */
function trainRefusal({
  reviewed,
  training,
}: {
  reviewed: number;
  training: DatasetTrainingReadiness;
}) {
  if (training.active !== null) return m.training_refused_active();
  if (reviewed < MIN_SNAPSHOT_IMAGES) {
    return m.training_refused_reviewed({ count: MIN_SNAPSHOT_IMAGES });
  }
  return null;
}
