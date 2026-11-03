import type { z } from "zod";

import type { timestampSchema } from "../time";

const WORKER_PRESENCES = ["online", "stale", "offline"] as const;

export type WorkerPresence = (typeof WORKER_PRESENCES)[number];

export const WORKER_ONLINE_SECONDS = 30;
export const WORKER_STALE_SECONDS = 90;

function secondsSince(
  timestamp: z.infer<typeof timestampSchema>,
  at: Date,
): number {
  return (at.getTime() - Date.parse(timestamp)) / 1000;
}

export function workerPresence(
  lastSeenAt: z.infer<typeof timestampSchema>,
  at: Date,
): WorkerPresence {
  const age = secondsSince(lastSeenAt, at);
  if (age <= WORKER_ONLINE_SECONDS) return "online";
  return age <= WORKER_STALE_SECONDS ? "stale" : "offline";
}
