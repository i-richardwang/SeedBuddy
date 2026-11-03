import type { WorkerPresence } from "../../domain/workers/presence";
import { m } from "../../paraglide/messages";
import type { StatusTone } from "../../ui/kit/Status";

const PRESENCE: Record<
  WorkerPresence,
  { label: () => string; tone: StatusTone }
> = {
  online: { label: m.worker_presence_online, tone: "success" },
  stale: { label: m.worker_presence_stale, tone: "warning" },
  offline: { label: m.worker_presence_offline, tone: "neutral" },
};

export function workerPresenceLabel(value: WorkerPresence): string {
  return PRESENCE[value].label();
}

export function workerPresenceTone(value: WorkerPresence): StatusTone {
  return PRESENCE[value].tone;
}
