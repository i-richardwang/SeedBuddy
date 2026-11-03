import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { TRAINING_PHASES } from "../domain/training/schema";
import { attemptClaimSchema } from "../domain/workers/schema";
import { enterTrainingPhase } from "../server/training/public";
import {
  parseWorkerSessionJson,
  workerErrorResponse,
} from "../server/transport/http/worker";

const bodySchema = attemptClaimSchema.extend({
  phase: z.enum(TRAINING_PHASES),
});

export const Route = createFileRoute("/api/worker/training/runs/$runId/phase")({
  server: {
    handlers: {
      POST: async ({ params, request, context }) => {
        try {
          const { phase, ...owner } = await parseWorkerSessionJson(
            request,
            bodySchema,
            context.workerId,
          );
          return Response.json(
            await enterTrainingPhase(params.runId, owner, phase),
          );
        } catch (error) {
          return workerErrorResponse(error, "Training phase transition failed");
        }
      },
    },
  },
});
