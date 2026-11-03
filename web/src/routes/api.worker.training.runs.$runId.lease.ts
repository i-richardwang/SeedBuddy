import { createFileRoute } from "@tanstack/react-router";

import { attemptClaimSchema } from "../domain/workers/schema";
import { renewTrainingLease } from "../server/training/public";
import {
  parseWorkerSessionJson,
  workerErrorResponse,
} from "../server/transport/http/worker";

export const Route = createFileRoute("/api/worker/training/runs/$runId/lease")({
  server: {
    handlers: {
      POST: async ({ params, request, context }) => {
        try {
          const owner = await parseWorkerSessionJson(
            request,
            attemptClaimSchema,
            context.workerId,
          );
          return Response.json(await renewTrainingLease(params.runId, owner));
        } catch (error) {
          return workerErrorResponse(error, "Training lease renewal failed");
        }
      },
    },
  },
});
