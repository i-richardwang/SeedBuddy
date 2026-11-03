import { MAX_IMAGE_BYTES } from "../../../domain/images/canonical";
import { imageDigestSchema } from "../../../domain/images/schema";
import {
  ImageSourceError,
  storeCanonicalImage,
  storeImage,
} from "../../images/public";
import { exactLengthBody, uploadFailure } from "./upload-body";

async function storing(
  store: () => Promise<{ digest: string }>,
): Promise<Response> {
  try {
    const stored = await store();
    return Response.json({ digest: stored.digest });
  } catch (error) {
    if (error instanceof ImageSourceError) {
      return uploadFailure(error.message, 400);
    }
    console.error(
      `Store image failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return uploadFailure("Could not store image", 500);
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
  return storing(() => storeImage(body));
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
  return storing(() => storeCanonicalImage(parsed.data, body));
}
