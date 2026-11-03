import { createFileRoute } from "@tanstack/react-router";

import { serveModelWeightsUpload } from "../server/transport/http/model-upload";
export const Route = createFileRoute(
  "/api/agent/model-uploads/$uploadId/weights",
)({
  server: {
    handlers: {
      PUT: ({ params, request }) =>
        serveModelWeightsUpload(params.uploadId, request),
    },
  },
});
