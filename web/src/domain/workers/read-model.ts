import type { WorkerPresence } from "./presence";
import type { WorkerActivity } from "./schema";

export interface WorkerOverview {
  workerId: string;
  /** The name of the account whose computer it is, or null for a shared worker. */
  ownerName: string | null;
  /** Whether the reader removes it. */
  removable: boolean;
  presence: WorkerPresence;
  lastSeenSeconds: number | null;
  activity: WorkerActivity | null;
}
export interface WorkerPresenceDetail {
  workers: WorkerOverview[];
}

/** A worker the reader may send training to; a personal one is the reader's own. */
export interface TrainingWorkerOverview {
  workerId: string;
  online: boolean;
  personal: boolean;
}
