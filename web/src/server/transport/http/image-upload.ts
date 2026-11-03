import { MAX_IMAGE_BYTES } from "../../../domain/images/canonical";
import { ImageSourceInvalidError } from "../../../domain/images/errors";
import { imageDigestSchema } from "../../../domain/images/schema";
import { storeCanonicalImage, storeImage } from "../../images/public";
import { refuseWithoutAgentKey } from "./agent";
import { agentUploadFailure, agentUploadRefusal } from "./agent-upload";
import { exactLengthBody, uploadFailure } from "./upload-body";

async function storing(
  store: () => Promise<{ digest: string }>,
  refuse: (error: unknown) => Response,
): Promise<Response> {
  try {
    const stored = await store();
    return Response.json({ digest: stored.digest });
  } catch (error) {
    return refuse(error);
  }
}

/**
 * Stores one image. The request is its bytes and nothing else: an image is
 * identified by what it contains, and the source name retained with it
 * belongs to the experiment observation that submits it, not to the image.
 */
export async function handleImageUpload(request: Request): Promise<Response> {
  const body = await exactLengthBody(request, MAX_IMAGE_BYTES);
  if (body instanceof Response) return body;
  return storing(
    () => storeImage(body),
    (error) => {
      if (error instanceof ImageSourceInvalidError)
        return uploadFailure(error.message, 400);
      console.error("Store image failed", error);
      return new Response("Could not store image", { status: 500 });
    },
  );
}

/**
 * Stores one canonical image under the digest it is addressed by, as a
 * dataset transfer delivers it. Storing is idempotent: bytes already here
 * are acknowledged the same way.
 */
export async function handleCanonicalImageUpload(
  digest: unknown,
  request: Request,
): Promise<Response> {
  const parsed = imageDigestSchema.safeParse(digest);
  if (!parsed.success) return uploadFailure("Not an image digest", 400);
  const body = await exactLengthBody(request, MAX_IMAGE_BYTES);
  if (body instanceof Response) return body;
  return storing(
    () => storeCanonicalImage(parsed.data, body),
    (error) => {
      if (error instanceof ImageSourceInvalidError)
        return uploadFailure(error.message, 400);
      console.error("Store image failed", error);
      return uploadFailure("Could not store image", 500);
    },
  );
}

/** Agent authentication stays at the transport boundary, like model uploads. */
export async function serveAgentImageUpload(
  request: Request,
): Promise<Response> {
  const refusal = await refuseWithoutAgentKey(request);
  if (refusal) return refusal;
  const body = await exactLengthBody(
    request,
    MAX_IMAGE_BYTES,
    agentUploadRefusal,
  );
  if (body instanceof Response) return body;
  return storing(
    () => storeImage(body),
    (error) => agentUploadFailure(error, "Store image"),
  );
}
