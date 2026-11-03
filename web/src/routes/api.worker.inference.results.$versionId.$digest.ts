import { createFileRoute } from "@tanstack/react-router";

import { detectionResultSchema } from "../domain/detection/schema";
import { inferenceTargetSchema } from "../domain/inference/assignments";
import { completeInferenceClaim } from "../server/inference/public";
import {
  parseAttemptOwner,
  parseWorkerJson,
  parseWorkerValue,
  workerErrorResponse,
} from "../server/transport/http/worker";

export const Route = createFileRoute(
  "/api/worker/inference/results/$versionId/$digest",
)({
  server: {
    handlers: {
      PUT: async ({ params, request, context }) => {
        try {
          const worker = parseAttemptOwner(request, context.workerId);
          const target = parseWorkerValue(
            params,
            inferenceTargetSchema,
            "Inference target",
          );
          await completeInferenceClaim(
            target,
            await parseWorkerJson(request, detectionResultSchema),
            worker,
          );
          return Response.json({});
        } catch (error) {
          return workerErrorResponse(
            error,
            "Could not record inference result",
          );
        }
      },
    },
  },
});
