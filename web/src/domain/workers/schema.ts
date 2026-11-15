import { z } from "zod";

import { isAdmin, type WorkbenchUser } from "../auth/schema";
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
});

export const workerSchema = workerReportSchema.extend({
  workerId: resourceIdSchema,
  lastSeenAt: timestampSchema,
});

/** A worker by the name it was enrolled under. */
export const workerRefSchema = z.strictObject({ workerId: resourceIdSchema });

/**
 * A worker to enroll and who it is for: everyone, or the account enrolling
 * it. A shared worker serves both queues unasked. A personal one is its
 * owner's computer: it detects for everyone while it runs and trains only
 * what its owner sends it.
 */
export const workerEnrollmentRequestSchema = workerRefSchema.extend({
  personal: z.boolean(),
});

/** The account a personal worker belongs to. */
export interface WorkerOwner {
  id: string;
  name: string;
}

/** An enrolled worker and the account it belongs to, or null when it is shared. */
export interface WorkerOwnership {
  workerId: string;
  owner: WorkerOwner | null;
}

export type WorkerActivity =
  | { kind: "inference"; subject: { digest: string; filename: string | null } }
  | { kind: "training"; subject: { runId: string; dataset: NamedDataset } };

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

/**
 * Whether a worker takes the training an account sends it: a shared worker
 * from anyone, a personal one only from the account that owns it.
 */
export function takesTrainingFrom(owner: string | null, user: string): boolean {
  return owner === null || owner === user;
}

/** Whether an account removes a worker: an administrator any, an account its own. */
export function removesWorker(
  user: Pick<WorkbenchUser, "id" | "role">,
  owner: string | null,
): boolean {
  return isAdmin(user) || owner === user.id;
}

/** Training runs on the ultralytics runtime; a worker without it only detects. */
export function canTrain(worker: Pick<Worker, "runtimes">): boolean {
  return worker.runtimes.some((runtime) => runtime.adapter === "ultralytics");
}
