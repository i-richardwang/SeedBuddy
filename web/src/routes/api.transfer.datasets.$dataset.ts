import { createFileRoute } from "@tanstack/react-router";

import { DatasetImportError } from "../domain/datasets/errors";
import {
  DatasetManifestTooLargeError,
  datasetManifestSchema,
  encodeDatasetManifest,
  MAX_DATASET_MANIFEST_BYTES,
} from "../domain/datasets/manifest";
import { importDataset, readDatasetManifest } from "../server/datasets/public";

function failed(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

async function manifestBody(request: Request): Promise<unknown | Response> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    return failed("Manifest Content-Length is required", 411);
  }
  if (declaredLength > MAX_DATASET_MANIFEST_BYTES) {
    return failed("Manifest exceeds 16 MiB", 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength !== declaredLength) {
    return failed("Manifest length differs from Content-Length", 400);
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return failed("The body is not JSON", 400);
  }
}

export const Route = createFileRoute("/api/transfer/datasets/$dataset")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const manifest = await readDatasetManifest(params.dataset);
        if (!manifest) return new Response("Not found", { status: 404 });
        try {
          return new Response(encodeDatasetManifest(manifest), {
            headers: { "content-type": "application/json" },
          });
        } catch (error) {
          if (error instanceof DatasetManifestTooLargeError) {
            return failed(error.message, 422);
          }
          throw error;
        }
      },
      PUT: async ({ params, request }) => {
        const body = await manifestBody(request);
        if (body instanceof Response) return body;
        const parsed = datasetManifestSchema.safeParse(body);
        if (!parsed.success) {
          return failed(
            `Not a dataset manifest: ${parsed.error.issues
              .map((issue) => `${issue.path.join(".")} ${issue.message}`)
              .join("; ")}`,
            400,
          );
        }
        if (parsed.data.dataset !== params.dataset) {
          return failed("The manifest describes another dataset", 400);
        }
        try {
          const dataset = await importDataset(parsed.data);
          return Response.json({ dataset }, { status: 201 });
        } catch (error) {
          if (error instanceof DatasetImportError) {
            return failed(error.message, 409);
          }
          throw error;
        }
      },
    },
  },
});
