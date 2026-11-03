import { createFileRoute } from "@tanstack/react-router";

import { workerSessionSchema } from "../domain/workers/schema";
import { claimInferenceTask } from "../server/inference/public";
import {
  parseWorkerSessionJson,
  workerErrorResponse,
} from "../server/transport/http/worker";

export const Route = createFileRoute("/api/worker/inference/claim")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        try {
          const owner = await parseWorkerSessionJson(
            request,
            workerSessionSchema,
            context.workerId,
          );
          return Response.json({
            assignment: await claimInferenceTask(owner),
          });
        } catch (error) {
          return workerErrorResponse(error, "Could not claim inference work");
        }
      },
    },
  },
});
