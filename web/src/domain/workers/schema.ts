import { z } from "zod";

import type { NamedDataset } from "../datasets/schema";
import { resourceIdSchema } from "../identifiers/schema";
import { runtimeDescriptorSchema } from "../inference/schema";
import { timestampSchema } from "../time";

const runtimesSchema = z
  .array(runtimeDescriptorSchema)
  .min(1)
  .refine(
    (runtimes) =>
      new Set(runtimes.map((runtime) => runtime.adapter)).size ===
      runtimes.length,
    "each adapter appears once",
  );

/**
 * The process session a worker request names. Which worker sent it follows
 * from the token the request carries, never from the request itself.
 */
export const workerSessionSchema = z.strictObject({
  sessionId: resourceIdSchema,
});

/** The execution attempt owned by a worker process session. */
export const attemptClaimSchema = workerSessionSchema.extend({
  attempt: z.number().int().positive(),
});
type AttemptClaim = z.infer<typeof attemptClaimSchema>;
export type AttemptOwner = WorkerIdentity & AttemptClaim;

/** What a worker process reports about itself on every heartbeat. */
export const workerReportSchema = workerSessionSchema.extend({
  startedAt: timestampSchema,
  runtimes: runtimesSchema,
  memoryBytes: z.number().int().positive(),
});

export const workerSchema = workerReportSchema.extend({
  workerId: resourceIdSchema,
  lastSeenAt: timestampSchema,
});

/** A worker by the name its administrator enrolled it under. */
export const workerRefSchema = z.strictObject({ workerId: resourceIdSchema });

export type WorkerActivity =
  | { kind: "inference"; image: string }
  | { kind: "training"; runId: string; dataset: NamedDataset };

/** A worker session as the server knows it: the enrolled worker and its process. */
export interface WorkerIdentity {
  workerId: string;
  sessionId: string;
}
type WorkerReport = z.infer<typeof workerReportSchema>;
export type WorkerHeartbeat = WorkerReport & { workerId: string };
export type Worker = z.infer<typeof workerSchema>;

/** A newly enrolled worker with its token, which is shown only this once. */
export interface EnrolledWorker {
  workerId: string;
  token: string;
}

/** Training runs on the ultralytics runtime; a worker without it only detects. */
export function canTrain(worker: Pick<Worker, "runtimes">): boolean {
  return worker.runtimes.some((runtime) => runtime.adapter === "ultralytics");
}
