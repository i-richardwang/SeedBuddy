import { createFileRoute } from "@tanstack/react-router";

import { snapshotForRun } from "../server/training/public";
import { imageResponse } from "../server/transport/http/image-files";
import {
  parseAttemptOwner,
  workerErrorResponse,
} from "../server/transport/http/worker";

export const Route = createFileRoute(
  "/api/worker/training/runs/$runId/images/$digest",
)({
  server: {
    handlers: {
      GET: async ({ params, request, context }) => {
        try {
          const owner = parseAttemptOwner(request, context.workerId);
          const snapshot = await snapshotForRun(params.runId, owner);
          if (!snapshot.images.some((image) => image.digest === params.digest))
            return new Response("Not found", { status: 404 });
          return imageResponse(params.digest);
        } catch (error) {
          return workerErrorResponse(error, "Training image request failed");
        }
      },
    },
  },
});
