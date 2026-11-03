import { z } from "zod";

import { sha256Schema } from "../../../domain/identifiers/schema";
import { modelBundleSchema } from "../../../domain/models/bundle";
import { MAX_MODEL_MANIFEST_BYTES } from "../../../domain/models/transfer";
import { artifactPartSize } from "../../../domain/training/artifact";
import {
  completeTrainingRun,
  saveTrainingArtifactPart,
} from "../../training/public";
import { exactLengthBody } from "./upload-body";
import {
  parseArtifactQuery,
  parseAttemptOwner,
  parseWorkerValue,
  WorkerRequestError,
  workerErrorResponse,
  workerFailure,
} from "./worker";

export async function serveTrainingArtifactPart(
  runId: string,
  request: Request,
  workerId: string,
): Promise<Response> {
  try {
    const owner = parseAttemptOwner(request, workerId);
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
    if (!size) throw new WorkerRequestError("Part is outside the artifact");
    const bytes = await exactLengthBody(request, size, workerFailure);
    if (bytes instanceof Response) return bytes;
    if (bytes.byteLength !== size)
      throw new WorkerRequestError("Artifact part length does not match");
    await saveTrainingArtifactPart(runId, owner, upload, part, digest, bytes);
    return new Response(null, { status: 204 });
  } catch (error) {
    return workerErrorResponse(error, "Training artifact part upload failed");
  }
}

export async function serveTrainingArtifact(
  runId: string,
  request: Request,
  workerId: string,
): Promise<Response> {
  try {
    const bytes = await exactLengthBody(
      request,
      MAX_MODEL_MANIFEST_BYTES,
      workerFailure,
    );
    if (bytes instanceof Response) return bytes;
    const owner = parseAttemptOwner(request, workerId);
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new WorkerRequestError("Request body must be valid JSON");
    }
    const bundle = parseWorkerValue(value, modelBundleSchema, "Request body");
    return Response.json(await completeTrainingRun(runId, owner, bundle));
  } catch (error) {
    return workerErrorResponse(error, "Training artifact publication failed");
  }
}
