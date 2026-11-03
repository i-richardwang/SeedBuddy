import {
  DatasetImportInvalidError,
  DatasetManifestTooLargeError,
} from "../../../domain/datasets/errors";
import {
  datasetManifestSchema,
  encodeDatasetManifest,
  MAX_DATASET_MANIFEST_BYTES,
} from "../../../domain/datasets/manifest";
import { importDataset, readDatasetManifest } from "../../datasets/public";
import { exactLengthBody, uploadFailure as failed } from "./upload-body";

async function manifestBody(request: Request): Promise<unknown | Response> {
  const bytes = await exactLengthBody(request, MAX_DATASET_MANIFEST_BYTES);
  if (bytes instanceof Response) return bytes;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return failed("The body is not JSON", 400);
  }
}

export async function serveDatasetManifest(name: string): Promise<Response> {
  const manifest = await readDatasetManifest(name);
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
}

export async function serveDatasetImport(
  name: string,
  request: Request,
): Promise<Response> {
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
  if (parsed.data.dataset !== name) {
    return failed("The manifest describes another dataset", 400);
  }
  try {
    const dataset = await importDataset(parsed.data);
    return Response.json({ dataset }, { status: 201 });
  } catch (error) {
    if (error instanceof DatasetImportInvalidError) {
      return failed(error.message, 409);
    }
    throw error;
  }
}
