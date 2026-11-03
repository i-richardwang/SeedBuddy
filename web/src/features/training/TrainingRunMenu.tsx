import { ChevronDown, CircleSlash, Pause, Play, RotateCcw } from "lucide-react";

import {
  isTrainingRunActive,
  isTrainingRunResumable,
  type TrainingRun,
} from "../../domain/training/schema";
import { m } from "../../paraglide/messages";
import { Button } from "../../ui/kit/Button";
import { type DropdownItem, DropdownMenu } from "../../ui/kit/DropdownMenu";
import type { TrainingRunControl } from "./run-control";
import { TrainingRunState } from "./TrainingRunState";

/**
 * The run's status, as a menu of what changes it: a queued or running run
 * pauses, a paused one continues and a failed one retries, both on a Worker
 * chosen in a dialog, and any of them cancels. Neither continues while
 * another run of the model is in progress (`blocked`). A finished run's
 * status is plain.
 */
export function TrainingRunMenu({
  run,
  blocked,
  control,
}: {
  run: TrainingRun;
  blocked: boolean;
  control: TrainingRunControl;
}) {
  const resumable = isTrainingRunResumable(run);
  if (!resumable && !isTrainingRunActive(run))
    return <TrainingRunState run={run} />;

  const items: DropdownItem[] = resumable
    ? [
        run.state.status === "failed"
          ? {
              key: "retry",
              icon: RotateCcw,
              label: m.training_menu_retry(),
              disabled: blocked,
              onClick: control.resume,
            }
          : {
              key: "resume",
              icon: Play,
              label: m.training_menu_resume(),
              disabled: blocked,
              onClick: control.resume,
            },
      ]
    : [
        {
          key: "pause",
          icon: Pause,
          label: m.training_menu_pause(),
          onClick: control.pause,
        },
      ];
  items.push(
    { type: "divider" },
    {
      key: "cancel",
      icon: CircleSlash,
      danger: true,
      label: m.training_menu_cancel(),
      onClick: control.cancel,
    },
  );

  return (
    <DropdownMenu items={items}>
      <Button
        size="small"
        type="text"
        icon={ChevronDown}
        iconPosition="end"
        loading={control.busy}
      >
        <TrainingRunState run={run} />
      </Button>
    </DropdownMenu>
  );
}
