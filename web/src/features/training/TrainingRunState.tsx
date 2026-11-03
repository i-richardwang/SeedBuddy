import {
  CircleCheck,
  CirclePause,
  CircleSlash,
  CircleX,
  Clock,
  LoaderCircle,
  type LucideIcon,
  Unplug,
} from "lucide-react";

import type {
  TrainingAttempt,
  TrainingRun,
} from "../../domain/training/schema";
import { m } from "../../paraglide/messages";
import { Status, type StatusProps, type StatusTone } from "../../ui/kit/Status";

interface Look {
  tone: StatusTone;
  icon: LucideIcon;
}

const PHASE_LABELS = {
  preparing: m.run_state_preparing,
  training: m.run_state_training,
  validating: m.run_state_validating,
} as const;

const STATUS_LABELS = {
  queued: m.run_state_queued,
  paused: m.run_state_paused,
  cancelled: m.run_state_cancelled,
  succeeded: m.run_state_succeeded,
  failed: m.run_state_failed,
} as const;

const LOOKS: Record<TrainingRun["state"]["status"], Look> = {
  paused: { tone: "neutral", icon: CirclePause },
  cancelled: { tone: "neutral", icon: CircleSlash },
  queued: { tone: "neutral", icon: Clock },
  running: { tone: "info", icon: LoaderCircle },
  succeeded: { tone: "success", icon: CircleCheck },
  failed: { tone: "error", icon: CircleX },
};

const OUTCOMES: Record<
  NonNullable<TrainingAttempt["outcome"]>,
  Look & { label: () => string }
> = {
  succeeded: { ...LOOKS.succeeded, label: m.run_state_succeeded },
  failed: { ...LOOKS.failed, label: m.run_state_failed },
  paused: { ...LOOKS.paused, label: m.run_state_paused },
  cancelled: { ...LOOKS.cancelled, label: m.run_state_cancelled },
  expired: { tone: "warning", icon: Unplug, label: m.attempt_state_expired },
};

/**
 * A run's status; a running run names its phase and its glyph turns. Other
 * props reach the status, so it can be a tooltip trigger.
 */
export function TrainingRunState({
  run,
  ...props
}: { run: TrainingRun } & Omit<
  StatusProps,
  "children" | "tone" | "icon" | "spin"
>) {
  const { state } = run;
  const look = LOOKS[state.status];
  return (
    <Status
      {...props}
      tone={look.tone}
      icon={look.icon}
      spin={state.status === "running"}
    >
      {state.status === "running"
        ? PHASE_LABELS[state.phase]()
        : STATUS_LABELS[state.status]()}
    </Status>
  );
}

/**
 * How one attempt ended, in the looks of the run's own statuses; an attempt
 * still under way reads as in progress and its glyph turns.
 */
export function TrainingAttemptState({
  outcome,
}: {
  outcome: TrainingAttempt["outcome"];
}) {
  if (outcome === null)
    return (
      <Status tone={LOOKS.running.tone} icon={LOOKS.running.icon} spin>
        {m.attempt_state_running()}
      </Status>
    );
  const look = OUTCOMES[outcome];
  return (
    <Status tone={look.tone} icon={look.icon}>
      {look.label()}
    </Status>
  );
}
