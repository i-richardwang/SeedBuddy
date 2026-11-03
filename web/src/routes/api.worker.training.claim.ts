import { createFileRoute } from "@tanstack/react-router";

import { workerSessionSchema } from "../domain/workers/schema";
import { claimTrainingRun } from "../server/training/public";
import {
  parseWorkerSessionJson,
  workerErrorResponse,
} from "../server/transport/http/worker";

export const Route = createFileRoute("/api/worker/training/claim")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        try {
          const owner = await parseWorkerSessionJson(
            request,
            workerSessionSchema,
            context.workerId,
          );
          return Response.json({ run: await claimTrainingRun(owner) });
        } catch (error) {
          return workerErrorResponse(error, "Training run claim failed");
        }
      },
    },
  },
});
