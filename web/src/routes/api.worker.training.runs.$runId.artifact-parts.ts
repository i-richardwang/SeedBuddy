import { createFileRoute } from "@tanstack/react-router";

import { serveTrainingArtifactPart } from "../server/transport/http/training-artifact";

export const Route = createFileRoute(
  "/api/worker/training/runs/$runId/artifact-parts",
)({
  server: {
    handlers: {
      PUT: ({ params, request, context }) =>
        serveTrainingArtifactPart(params.runId, request, context.workerId),
    },
  },
});
