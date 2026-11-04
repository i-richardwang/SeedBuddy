import { createFileRoute } from "@tanstack/react-router";

import { trainingEpochReportSchema } from "../domain/training/schema";
import { attemptClaimSchema } from "../domain/workers/schema";
import { recordTrainingEpoch } from "../server/training/public";
import {
  parseWorkerSessionJson,
  workerErrorResponse,
} from "../server/transport/http/worker";

const bodySchema = attemptClaimSchema.extend(trainingEpochReportSchema.shape);

export const Route = createFileRoute("/api/worker/training/runs/$runId/epochs")(
  {
    server: {
      handlers: {
        POST: async ({ params, request, context }) => {
          try {
            const { workerId, sessionId, attempt, ...report } =
              await parseWorkerSessionJson(
                request,
                bodySchema,
                context.workerId,
              );
            return Response.json(
              await recordTrainingEpoch(params.runId, report, {
                workerId,
                sessionId,
                attempt,
              }),
            );
          } catch (error) {
            return workerErrorResponse(error, "Training epoch report failed");
          }
        },
      },
    },
  },
);
