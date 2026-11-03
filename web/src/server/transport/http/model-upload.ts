import { DomainError } from "../../../domain/errors";
import { MAX_MODEL_WEIGHTS_BYTES } from "../../../domain/models/transfer";
import { uploadModelWeights } from "../../models/public";
import { refuseWithoutAgentKey } from "./agent";
import { exactLengthBody, uploadFailure } from "./upload-body";

export async function serveModelWeightsUpload(
  uploadId: string,
  request: Request,
): Promise<Response> {
  const refusal = await refuseWithoutAgentKey(request);
  if (refusal) return refusal;
  try {
    const bytes = await exactLengthBody(request, MAX_MODEL_WEIGHTS_BYTES);
    if (bytes instanceof Response) return bytes;
    await uploadModelWeights(uploadId, bytes);
    return Response.json({ uploadId });
  } catch (error) {
    if (error instanceof DomainError)
      return uploadFailure(
        error.message,
        error.category === "not_found" ? 404 : 400,
      );
    console.error("Model upload failed", error);
    return uploadFailure("Could not upload weights", 500);
  }
}
