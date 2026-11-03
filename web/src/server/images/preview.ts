import sharp from "sharp";

import { MAX_SOURCE_IMAGE_PIXELS } from "../../domain/images/canonical";
import { createSingleFlight } from "../../lib/async/work";
import {
  blobExists,
  type OpenBlob,
  openBlob,
  putImmutableBlob,
  readBlob,
} from "../infra/blobs/store";
import { imageBlobKey, imagePreviewKey } from "./keys";
import { processImage } from "./processing";

/**
 * A preview is an image made small enough to arrive at once: what a reader
 * looks at while the image itself is on its way, and all that a picture
 * beside a list needs. It holds the whole frame, so anything drawn over the
 * image lines up with it once it is stretched to the image's size.
 *
 * At this edge and quality a preview weighs a small fraction of its image and
 * still fills a screen without visible softness.
 */
const EDGE_PIXELS = 2048;
const QUALITY = 60;

const preparing = createSingleFlight<boolean>();

/**
 * Stores the preview of an image that has none yet. False when no such image
 * is stored.
 */
export function prepareImagePreview(digest: string): Promise<boolean> {
  return preparing(digest, () =>
    processImage(async () => {
      const key = imagePreviewKey(digest);
      if (await blobExists(key)) return true;
      const source = await readBlob(imageBlobKey(digest));
      if (!source) return false;
      const preview = await sharp(source, {
        limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
      })
        .resize({
          width: EDGE_PIXELS,
          height: EDGE_PIXELS,
          fit: "inside",
          withoutEnlargement: true,
        })
        .avif({ quality: QUALITY })
        .toBuffer();
      await putImmutableBlob(key, preview);
      return true;
    }),
  );
}

/** An image's preview, prepared first if it has none; null when no such image is stored. */
export async function openImagePreview(
  digest: string,
): Promise<OpenBlob | null> {
  const key = imagePreviewKey(digest);
  const stored = await openBlob(key);
  if (stored) return stored;
  return (await prepareImagePreview(digest)) ? openBlob(key) : null;
}
