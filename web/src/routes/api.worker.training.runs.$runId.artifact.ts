import { createFileRoute } from "@tanstack/react-router";

import { modelBundleSchema } from "../domain/models/bundle";
import { MAX_MODEL_MANIFEST_BYTES } from "../domain/models/transfer";
import { publishTrainingArtifact } from "../server/training/public";
import {
  parseTrainingQuery,
  parseWorkerJson,
  workerErrorResponse,
} from "../server/transport/http/worker";

/** Publishes the completed weights described by a small model manifest. */
export const Route = createFileRoute(
  "/api/worker/training/runs/$runId/artifact",
)({
  server: {
    handlers: {
      POST: async ({ params, request, context }) => {
        const length = Number(request.headers.get("content-length"));
        if (!Number.isSafeInteger(length) || length <= 0)
          return new Response("Content-Length is required", { status: 411 });
        if (length > MAX_MODEL_MANIFEST_BYTES)
          return new Response("Model manifest is too large", { status: 413 });
        try {
          const owner = parseTrainingQuery(request, context.workerId);
          const bundle = await parseWorkerJson(request, modelBundleSchema);
          return Response.json(
            await publishTrainingArtifact(params.runId, owner, bundle),
          );
        } catch (error) {
          return workerErrorResponse(
            error,
            "Training artifact publication failed",
          );
        }
      },
    },
  },
});
