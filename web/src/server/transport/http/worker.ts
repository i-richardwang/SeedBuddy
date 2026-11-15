import { createMiddleware } from "@tanstack/react-start";
import type { ZodType } from "zod";

import { failureCategory } from "../../../domain/errors";
import { artifactUploadSchema } from "../../../domain/training/artifact";
import {
  WORKER_PROTOCOL,
  WORKER_PROTOCOL_HEADER,
} from "../../../domain/workers/protocol";
import {
  type AttemptOwner,
  attemptClaimSchema,
} from "../../../domain/workers/schema";
import { bearerToken } from "../../auth/public";
import { authenticateWorker } from "../../workers/public";

/** Worker protocol refusals are plain text under the actionable HTTP status. */
export function workerFailure(
  message: string,
  status: number,
  headers?: HeadersInit,
): Response {
  return new Response(message, { status, headers });
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
 * The refusal a request stating another protocol revision gets, or null: 426
 * naming the revision this workbench speaks.
 */
function refuseOtherProtocol(request: Request): Response | null {
  const stated = request.headers.get(WORKER_PROTOCOL_HEADER);
  if (stated === String(WORKER_PROTOCOL)) return null;
  return workerFailure(
    `This workbench speaks worker protocol ${WORKER_PROTOCOL}, not ${stated ?? "none"}; install the worker package it ships`,
    426,
    { Upgrade: `seedbuddy-worker/${WORKER_PROTOCOL}` },
  );
}

/**
 * The worker API answers only to a process that speaks this workbench's
 * protocol revision and presents an enrolled worker's token, and hands the
 * worker it proves to the route. A personal worker is refused while its
 * owner's account is suspended.
 */
export const requireEnrolledWorker = createMiddleware().server(
  async ({ request, next }) => {
    const refusal = refuseOtherProtocol(request);
    if (refusal) return refusal;
    const token = bearerToken(request);
    const worker = token ? await authenticateWorker(token) : null;
    if (!worker) return workerFailure("Unknown worker token", 401);
    if (worker.suspended)
      return workerFailure(
        "The account this worker belongs to is suspended; start the worker again once the account is reinstated",
        403,
      );
    return next({ context: { workerId: worker.workerId } });
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
  const category = failureCategory(error);
  if (category !== null)
    return { not_found: 404, conflict: 409, invalid_request: 422 }[category];
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
      attemptClaimSchema,
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
