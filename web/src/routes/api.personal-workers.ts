import { createFileRoute } from "@tanstack/react-router";

import { handlePersonalWorkerEnrollment } from "../server/transport/http/personal-worker";

/** The signed-in account enrolls the computer it is using as a personal Worker. */
export const Route = createFileRoute("/api/personal-workers")({
  server: {
    handlers: {
      POST: ({ request }) => handlePersonalWorkerEnrollment(request),
    },
  },
});
