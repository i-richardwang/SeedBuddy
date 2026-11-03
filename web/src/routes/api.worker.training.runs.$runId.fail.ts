import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { attemptOwnerSchema } from "../domain/workers/schema";
import { failTrainingRun } from "../server/training/public";
import {
  parseWorkerSessionJson,
  workerErrorResponse,
} from "../server/transport/http/worker";

const bodySchema = attemptOwnerSchema.extend({
  error: z.string().min(1).max(2000),
});

export const Route = createFileRoute("/api/worker/training/runs/$runId/fail")({
  server: {
    handlers: {
      POST: async ({ params, request, context }) => {
        try {
          const body = await parseWorkerSessionJson(
            request,
            bodySchema,
            context.workerId,
          );
          return Response.json(
            await failTrainingRun(
              params.runId,
              {
                workerId: body.workerId,
                sessionId: body.sessionId,
                attempt: body.attempt,
              },
              body.error,
            ),
          );
        } catch (error) {
          return workerErrorResponse(
            error,
            "Training run failure report failed",
          );
        }
      },
    },
  },
});
