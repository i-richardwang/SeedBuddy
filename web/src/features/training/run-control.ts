import { useState } from "react";

import { identifierLabel } from "../../domain/identifiers/schema";
import type { TrainingRunDetail } from "../../domain/training/read-model";
import type { TrainingControl } from "../../domain/training/schema";
import { isTrainingRunActive } from "../../domain/training/schema";
import { updateTrainingRun } from "../../functions/training";
import { m } from "../../paraglide/messages";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";

/**
 * What the run's page can do to the run: pause it, open the dialog that
 * continues it, cancel it. The status menu and the notices under the run
 * share one, so a pause begun from either shows on the status; the page
 * holds the dialog it opens.
 */
export function useTrainingRunControl(detail: TrainingRunDetail) {
  const confirmDestructive = useConfirmDestructive();
  const { run } = detail;
  // A blocked run follows the other run as it moves.
  useRouteRefresh(
    10_000,
    isTrainingRunActive(run) || detail.blockedBy !== null,
  );
  const action = useAsyncAction();
  const [resuming, setResuming] = useState(false);
  const send = (control: TrainingControl) => controlRun(detail, control);
  return {
    busy: action.busy,
    pause: () => {
      void action.run(() => send({ action: "pause" }), m.training_not_paused());
    },
    resume: () => setResuming(true),
    cancel: () => {
      confirmDestructive({
        title: m.training_cancel_title({ run: identifierLabel(run.id) }),
        content: m.training_cancel_note(),
        confirmLabel: m.training_cancel_confirm(),
        failure: m.training_not_cancelled(),
        onConfirm: async () => {
          await send({ action: "cancel" });
        },
      });
    },
    resuming,
    closeResume: () => setResuming(false),
  };
}

export type TrainingRunControl = ReturnType<typeof useTrainingRunControl>;

/**
 * Sends a control to the run as the page read it, so a run that has moved
 * on since refuses it.
 */
export function controlRun(
  { dataset, run }: Pick<TrainingRunDetail, "dataset" | "run">,
  control: TrainingControl,
) {
  return updateTrainingRun({
    data: { dataset: dataset.id, runId: run.id, attempt: run.attempt, control },
  });
}
