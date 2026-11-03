import { attemptOwnerSchema } from "../domain/workers/schema";
import { createFileRoute } from "@tanstack/react-router";

import { inferenceTargetSchema } from "../domain/inference/assignments";
import { renewInferenceClaim } from "../server/inference/public";
import {
  parseWorkerSessionJson,
  parseWorkerValue,
  workerErrorResponse,
} from "../server/transport/http/worker";

/** The claim a request speaks for: its target, held by the calling session. */
async function claimOf(params: unknown, request: Request, workerId: string) {
  const target = parseWorkerValue(
    params,
    inferenceTargetSchema,
    "Inference target",
  );
  const owner = await parseWorkerSessionJson(
    request,
    attemptOwnerSchema,
    workerId,
  );
  return { target, owner };
}

export const Route = createFileRoute(
  "/api/worker/inference/claims/$versionId/$digest/lease",
)({
  server: {
    handlers: {
      POST: async ({ params, request, context }) => {
        try {
          const { target, owner } = await claimOf(
            params,
            request,
            context.workerId,
          );
          return Response.json(await renewInferenceClaim(target, owner));
        } catch (error) {
          return workerErrorResponse(error, "Could not renew inference lease");
        }
      },
    },
  },
});
