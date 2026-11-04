import { createFileRoute } from "@tanstack/react-router";

import { workerReportSchema } from "../domain/workers/schema";
import {
  parseWorkerSessionJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
import { recordWorkerHeartbeat } from "../server/workers/public";

export const Route = createFileRoute("/api/worker/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        try {
          return Response.json(
            await recordWorkerHeartbeat(
              await parseWorkerSessionJson(
                request,
                workerReportSchema,
                context.workerId,
              ),
            ),
          );
        } catch (error) {
          return workerErrorResponse(error, "Could not record heartbeat");
        }
      },
    },
  },
});
