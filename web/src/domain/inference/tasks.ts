import { timestampSchema } from "../identifiers/schema";
import { z } from "zod";
import { inferenceTargetSchema } from "./assignments";

export const inferenceFailureSchema = z.strictObject({
  code: z.enum([
    "transport",
    "execution",
    "invalid_input",
    "interrupted",
    "timeout",
    "lease_expired",
    "session_replaced",
  ]),
  message: z.string().min(1).max(2000),
});
export type InferenceFailure = z.infer<typeof inferenceFailureSchema>;
export const inferenceTaskFailureSchema = inferenceTargetSchema.extend({
  error: z.string(),
});
export const inferenceTaskSchema = inferenceTargetSchema.extend({
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  attempt: z.number().int().nonnegative(),
  attemptsInCycle: z.number().int().nonnegative(),
  availableAt: timestampSchema,
  error: z.string().nullable(),
  attempts: z.array(
    z.strictObject({
      attempt: z.number().int().positive(),
      workerId: z.string(),
      sessionId: z.string(),
      startedAt: timestampSchema,
      deadlineAt: timestampSchema,
      leaseExpiresAt: timestampSchema,
      finishedAt: timestampSchema.nullable(),
      status: z.enum(["running", "succeeded", "failed"]),
      failure: inferenceFailureSchema.nullable(),
    }),
  ),
});
