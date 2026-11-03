import { createFileRoute } from "@tanstack/react-router";

/** A token check: which enrolled Worker the token belongs to. */
export const Route = createFileRoute("/api/worker/ready")({
  server: {
    handlers: {
      GET: ({ context }) => Response.json({ workerId: context.workerId }),
    },
  },
});
