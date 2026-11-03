import { createFileRoute } from "@tanstack/react-router";

import { openModelWeights } from "../server/models/public";
import { workerErrorResponse } from "../server/transport/http/worker";
export const Route = createFileRoute(
  "/api/worker/inference/model-versions/$versionId/weights",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const weights = await openModelWeights(params.versionId);
          return new Response(weights.stream, {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(weights.size),
            },
          });
        } catch (error) {
          return workerErrorResponse(error, "Could not download model weights");
        }
      },
    },
  },
});
