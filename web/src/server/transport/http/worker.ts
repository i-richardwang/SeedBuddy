import { createMiddleware } from "@tanstack/react-start";
import type { ZodType } from "zod";

import { DomainError } from "../../../domain/errors";
import { InvalidDetectionOutcomeError } from "../../../domain/inference/errors";
import { artifactUploadSchema } from "../../../domain/training/artifact";
import {
  type AttemptOwner,
  attemptOwnerSchema,
} from "../../../domain/workers/schema";
import { bearerToken } from "../../auth/public";
import { authenticateWorker } from "../../workers/public";

/** Worker protocol refusals are plain text under the actionable HTTP status. */
function workerFailure(message: string, status: number): Response {
  return new Response(message, { status });
}

/** A request a worker route refuses before touching any record. */
export class WorkerRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422 = 400,
  ) {
    super(message);
  }
}

/**
 * The worker API answers only to an enrolled worker's token, and hands the
 * worker it proves to the route.
 */
export const requireEnrolledWorker = createMiddleware().server(
  async ({ request, next }) => {
    const token = bearerToken(request);
    const workerId = token ? await authenticateWorker(token) : null;
    if (!workerId) return workerFailure("Unknown worker token", 401);
    return next({ context: { workerId } });
  },
);

export async function parseWorkerJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new WorkerRequestError("Request body must be valid JSON");
  }
  return parseWorkerValue(value, schema, "Request body");
}

/**
 * A JSON request a worker session makes: the body names the session, and
 * the worker is the one the token proved.
 */
export async function parseWorkerSessionJson<T extends { sessionId: string }>(
  request: Request,
  schema: ZodType<T>,
  workerId: string,
): Promise<T & { workerId: string }> {
  return { ...(await parseWorkerJson(request, schema)), workerId };
}

export function parseWorkerValue<T>(
  value: unknown,
  schema: ZodType<T>,
  name: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new WorkerRequestError(`${name} is invalid`);
  return parsed.data;
}

function statusOf(error: unknown): number | null {
  if (error instanceof WorkerRequestError) return error.status;
  if (error instanceof InvalidDetectionOutcomeError) return 400;
  if (error instanceof DomainError)
    return error.category === "not_found"
      ? 404
      : error.category === "conflict"
        ? 409
        : 422;
  return null;
}

/**
 * The protocol answer for a failure: its message under the status the worker
 * acts on, or the operation name under 500 when the failure is the server's.
 */
export function workerErrorResponse(
  error: unknown,
  operation: string,
): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = statusOf(error);
  if (status !== null) return workerFailure(message, status);
  console.error(`${operation}: ${message}`);
  return workerFailure(operation, 500);
}

export function parseAttemptOwner(
  request: Request,
  workerId: string,
): AttemptOwner {
  const query = new URL(request.url).searchParams;
  return {
    workerId,
    ...parseWorkerValue(
      {
        sessionId: query.get("sessionId"),
        attempt: Number(query.get("attempt")),
      },
      attemptOwnerSchema,
      "Attempt owner",
    ),
  };
}

/** Describes the complete file for both part acceptance and publication. */
export function parseArtifactQuery(request: Request) {
  const query = new URL(request.url).searchParams;
  return parseWorkerValue(
    {
      bytes: Number(query.get("bytes")),
      digest: query.get("digest"),
    },
    artifactUploadSchema,
    "Artifact",
  );
}
