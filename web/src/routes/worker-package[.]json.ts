import { createFileRoute } from "@tanstack/react-router";

import { workerPackageDescription } from "../server/transport/http/worker-package";
import { shippedWorkerPackage } from "../server/workers/public";

/** Which worker package this workbench ships, for a program that keeps one installed. */
export const Route = createFileRoute("/worker-package.json")({
  server: {
    handlers: {
      GET: async () => workerPackageDescription(await shippedWorkerPackage()),
    },
  },
});
