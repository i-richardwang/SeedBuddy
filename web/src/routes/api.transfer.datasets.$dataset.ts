import { createFileRoute } from "@tanstack/react-router";

import {
  serveDatasetImport,
  serveDatasetManifest,
} from "../server/transport/http/dataset-transfer";

export const Route = createFileRoute("/api/transfer/datasets/$dataset")({
  server: {
    handlers: {
      GET: ({ params }) => serveDatasetManifest(params.dataset),
      PUT: ({ params, request }) => serveDatasetImport(params.dataset, request),
    },
  },
});
