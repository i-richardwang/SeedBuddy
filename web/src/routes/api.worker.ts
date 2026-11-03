import { createFileRoute } from "@tanstack/react-router";

import { requireEnrolledWorker } from "../server/transport/http/worker";

/** Every Worker route sits behind the token of an enrolled Worker. */
export const Route = createFileRoute("/api/worker")({
  server: { middleware: [requireEnrolledWorker] },
});
