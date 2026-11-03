import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { sha256Schema } from "../domain/identifiers/schema";
import { artifactPartSize } from "../domain/training/artifact";
import { saveTrainingArtifactPart } from "../server/training/public";
import {
  parseArtifactQuery,
  parseTrainingQuery,
  parseWorkerValue,
  WorkerRequestError,
  workerErrorResponse,
} from "../server/transport/http/worker";

/** Receives one immutable part of an artifact upload. */
export const Route = createFileRoute(
  "/api/worker/training/runs/$runId/artifact-parts",
)({
  server: {
    handlers: {
      PUT: async ({ params, request, context }) => {
        try {
          const owner = parseTrainingQuery(request, context.workerId);
          const query = new URL(request.url).searchParams;
          const upload = parseArtifactQuery(request);
          const part = parseWorkerValue(
            query.has("part") ? Number(query.get("part")) : -1,
            z.number().int().nonnegative(),
            "Part",
          );
          const digest = parseWorkerValue(
            request.headers.get("x-artifact-part-sha256"),
            sha256Schema,
            "Part digest",
          );
          const size = artifactPartSize(upload, part);
          if (!size)
            throw new WorkerRequestError("Part is outside the artifact");
          const length = Number(request.headers.get("content-length"));
          if (!Number.isSafeInteger(length) || length <= 0)
            return new Response("Content-Length is required", { status: 411 });
          if (length > size)
            return new Response("Artifact part is too large", {
              status: 413,
            });
          if (length !== size)
            throw new WorkerRequestError("Artifact part length does not match");
          const bytes = await readPart(request, size);
          await saveTrainingArtifactPart(
            params.runId,
            owner,
            upload,
            part,
            digest,
            bytes,
          );
          return new Response(null, { status: 204 });
        } catch (error) {
          return workerErrorResponse(
            error,
            "Training artifact part upload failed",
          );
        }
      },
    },
  },
});

/** Bound actual bytes too, rather than trusting a caller's Content-Length. */
async function readPart(request: Request, size: number): Promise<Uint8Array> {
  if (!request.body) throw new WorkerRequestError("Artifact part is empty");
  const reader = request.body.getReader();
  const bytes = new Uint8Array(size);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > size) {
        await reader.cancel();
        throw new WorkerRequestError("Artifact part exceeds declared size");
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== size)
    throw new WorkerRequestError("Artifact part is incomplete");
  return bytes;
}
