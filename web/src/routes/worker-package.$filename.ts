import { createFileRoute } from "@tanstack/react-router";

import { workerPackageResponse } from "../server/transport/http/worker-package";
import { shippedWorkerPackage } from "../server/workers/public";

/** The worker package this workbench ships, for `seedctl` to be installed from. */
export const Route = createFileRoute("/worker-package/$filename")({
  server: {
    handlers: {
      GET: async ({ params, request }) =>
        workerPackageResponse(
          await shippedWorkerPackage(),
          params.filename,
          request,
        ),
    },
  },
});
