import { MAX_MODEL_WEIGHTS_BYTES } from "../../../domain/models/transfer";
import { uploadModelWeights } from "../../models/public";
import { refuseWithoutAgentKey } from "./agent";
import { agentUploadFailure, agentUploadRefusal } from "./agent-upload";
import { exactLengthBody } from "./upload-body";

export async function serveModelWeightsUpload(
  uploadId: string,
  request: Request,
): Promise<Response> {
  const refusal = await refuseWithoutAgentKey(request);
  if (refusal) return refusal;
  try {
    const bytes = await exactLengthBody(
      request,
      MAX_MODEL_WEIGHTS_BYTES,
      agentUploadRefusal,
    );
    if (bytes instanceof Response) return bytes;
    await uploadModelWeights(uploadId, bytes);
    return Response.json({ uploadId });
  } catch (error) {
    return agentUploadFailure(error, "Upload model weights");
  }
}
