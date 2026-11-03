import type { WorkerPresence } from "../../domain/workers/presence";
import type { WorkerActivity } from "../../domain/workers/schema";
import { m } from "../../paraglide/messages";
import type { StatusTone } from "../../ui/kit/Status";

const PRESENCE = {
  online: { label: m.worker_presence_online, tone: "success" },
  stale: { label: m.worker_presence_stale, tone: "warning" },
  offline: { label: m.worker_presence_offline, tone: "neutral" },
} as const satisfies Record<
  WorkerPresence,
  { label: () => string; tone: StatusTone }
>;

export function workerPresenceLabel(value: WorkerPresence): string {
  return PRESENCE[value].label();
}

export function workerPresenceTone(value: WorkerPresence): StatusTone {
  return PRESENCE[value].tone;
}

export function workerActivityLabel(activity: WorkerActivity): string {
  if (activity.kind === "training")
    return m.worker_activity_training({
      dataset: activity.subject.dataset.name,
    });
  return activity.subject.filename === null
    ? m.worker_activity_inference_unnamed()
    : m.worker_activity_inference({ image: activity.subject.filename });
}
