import { createFileRoute } from "@tanstack/react-router";

import { inferenceTargetSchema } from "../domain/inference/assignments";
import { inferenceFailureSchema } from "../domain/inference/tasks";
import { attemptClaimSchema } from "../domain/workers/schema";
import { failInferenceAttempt } from "../server/inference/public";
import {
  parseWorkerSessionJson,
  parseWorkerValue,
  workerErrorResponse,
} from "../server/transport/http/worker";

export const Route = createFileRoute(
  "/api/worker/inference/claims/$versionId/$digest/fail",
)({
  server: {
    handlers: {
      POST: async ({ params, request, context }) => {
        try {
          const target = parseWorkerValue(
            params,
            inferenceTargetSchema,
            "Inference target",
          );
          const { failure, ...owner } = await parseWorkerSessionJson(
            request,
            attemptClaimSchema.extend({
              failure: inferenceFailureSchema,
            }),
            context.workerId,
          );
          await failInferenceAttempt(target, failure, owner);
          return Response.json({});
        } catch (error) {
          return workerErrorResponse(
            error,
            "Could not report inference failure",
          );
        }
      },
    },
  },
});
