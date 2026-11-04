import type { TrainingRun } from "../../domain/training/schema";
import { m } from "../../paraglide/messages";

/** Where a queued or running run runs, or will. */
export function runPlacement({ state, targetWorkerId }: TrainingRun) {
  if (state.status === "running")
    return m.training_worker_running({ worker: state.workerId });
  if (state.status !== "queued") return null;
  return targetWorkerId
    ? m.training_worker_waiting({ worker: targetWorkerId })
    : m.training_waiting_auto();
}
