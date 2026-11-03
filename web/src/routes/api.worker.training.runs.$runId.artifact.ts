import { createFileRoute } from "@tanstack/react-router";

import { serveTrainingArtifact } from "../server/transport/http/training-artifact";

export const Route = createFileRoute(
  "/api/worker/training/runs/$runId/artifact",
)({
  server: {
    handlers: {
      POST: ({ params, request, context }) =>
        serveTrainingArtifact(params.runId, request, context.workerId),
    },
  },
});
