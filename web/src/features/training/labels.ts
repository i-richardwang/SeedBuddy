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

import type { TrainingParameters } from "../../domain/training/parameters";
import type { TrainingPresetId } from "../../domain/training/recipes";
import type {
  TrainingAttempt,
  TrainingRun,
} from "../../domain/training/schema";
import { m } from "../../paraglide/messages";
import type { StatusTone } from "../../ui/kit/Status";

interface Look {
  tone: StatusTone;
  icon: LucideIcon;
}

const PHASE_LABELS = {
  preparing: m.run_state_preparing,
  training: m.run_state_training,
  validating: m.run_state_validating,
} as const satisfies Record<
  Extract<TrainingRun["state"], { status: "running" }>["phase"],
  () => string
>;

const STATUS_LABELS = {
  queued: m.run_state_queued,
  paused: m.run_state_paused,
  cancelled: m.run_state_cancelled,
  succeeded: m.run_state_succeeded,
  failed: m.failed_label,
} as const satisfies Record<
  Exclude<TrainingRun["state"]["status"], "running">,
  () => string
>;

const LOOKS = {
  paused: { tone: "neutral", icon: CirclePause },
  cancelled: { tone: "neutral", icon: CircleSlash },
  queued: { tone: "neutral", icon: Clock },
  running: { tone: "info", icon: LoaderCircle },
  succeeded: { tone: "success", icon: CircleCheck },
  failed: { tone: "error", icon: CircleX },
} as const satisfies Record<TrainingRun["state"]["status"], Look>;

const OUTCOMES = {
  succeeded: { ...LOOKS.succeeded, label: m.run_state_succeeded },
  failed: { ...LOOKS.failed, label: m.failed_label },
  paused: { ...LOOKS.paused, label: m.run_state_paused },
  cancelled: { ...LOOKS.cancelled, label: m.run_state_cancelled },
  expired: { tone: "warning", icon: Unplug, label: m.attempt_state_expired },
} as const satisfies Record<
  NonNullable<TrainingAttempt["outcome"]>,
  Look & { label: () => string }
>;

export function trainingRunLabel(run: TrainingRun): string {
  const { state } = run;
  return state.status === "running"
    ? PHASE_LABELS[state.phase]()
    : STATUS_LABELS[state.status]();
}
export function trainingRunTone(run: TrainingRun): StatusTone {
  return LOOKS[run.state.status].tone;
}
export function trainingRunIcon(run: TrainingRun): LucideIcon {
  return LOOKS[run.state.status].icon;
}
export function trainingAttemptLabel(
  outcome: TrainingAttempt["outcome"],
): string {
  return outcome === null
    ? m.attempt_state_running()
    : OUTCOMES[outcome].label();
}
export function trainingAttemptTone(
  outcome: TrainingAttempt["outcome"],
): StatusTone {
  return outcome === null ? LOOKS.running.tone : OUTCOMES[outcome].tone;
}
export function trainingAttemptIcon(
  outcome: TrainingAttempt["outcome"],
): LucideIcon {
  return outcome === null ? LOOKS.running.icon : OUTCOMES[outcome].icon;
}
const PARAMETER_LABELS = {
  epochs: m.parameter_epochs,
  patience: m.parameter_patience,
  batch: m.parameter_batch,
  nbs: m.parameter_nbs,
  imgsz: m.parameter_imgsz,
  optimizer: m.parameter_optimizer,
  lr0: m.parameter_lr0,
  warmup_epochs: m.parameter_warmup_epochs,
  mosaic: m.parameter_mosaic,
  mixup: m.parameter_mixup,
  copy_paste: m.parameter_copy_paste,
  max_det: m.parameter_max_det,
  seed: m.parameter_seed,
  deterministic: m.parameter_deterministic,
  scale: m.parameter_scale,
  degrees: m.parameter_degrees,
  flipud: m.parameter_flipud,
  fliplr: m.parameter_fliplr,
  translate: m.parameter_translate,
  hsv_h: m.parameter_hsv_h,
  hsv_s: m.parameter_hsv_s,
  hsv_v: m.parameter_hsv_v,
} as const satisfies Record<keyof TrainingParameters, () => string>;

export function parameterLabel(key: keyof TrainingParameters): string {
  return PARAMETER_LABELS[key]();
}
const PRESET_PRESENTATION = {
  "yolo26n-whole-v1": {
    label: m.training_preset_nano,
    description: m.training_preset_nano_description,
  },
  "yolo26s-whole-2048-v1": {
    label: m.training_preset_small,
    description: m.training_preset_small_description,
  },
} as const satisfies Record<
  TrainingPresetId,
  {
    label: () => string;
    description: () => string;
  }
>;

export function trainingPresetLabel(id: TrainingPresetId): string {
  return PRESET_PRESENTATION[id].label();
}
export function trainingPresetDescription(id: TrainingPresetId): string {
  return PRESET_PRESENTATION[id].description();
}
