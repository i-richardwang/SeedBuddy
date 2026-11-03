import { createFileRoute } from "@tanstack/react-router";

import { serveAgentImageUpload } from "../server/transport/http/image-upload";

export const Route = createFileRoute("/api/agent/images")({
  server: {
    handlers: {
      POST: async ({ request }) => serveAgentImageUpload(request),
    },
  },
});
