import type { WorkerPresence } from "./presence";
import type { WorkerActivity } from "./schema";
export interface WorkerOverview {
  workerId: string;
  presence: WorkerPresence;
  lastSeenSeconds: number | null;
  activity: WorkerActivity | null;
}
export interface WorkerPresenceDetail {
  workers: WorkerOverview[];
}

export interface TrainingWorkerOverview {
  workerId: string;
  online: boolean;
}
