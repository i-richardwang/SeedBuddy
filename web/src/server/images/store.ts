import { eq } from "drizzle-orm";

import { MAX_IMAGE_BYTES } from "../../domain/images/canonical";
import type { DishAnalysis } from "../../domain/images/coverage";
import { ImageSourceInvalidError } from "../../domain/images/errors";
import { createSingleFlight } from "../../lib/async/work";
import { putImmutableBlob } from "../infra/blobs/store";
import {
  database,
  type Executor,
  operationTime,
  transaction,
} from "../infra/db/client";
import { images } from "../infra/db/schema";
import { contentDigest } from "../infra/digest";
import { analyzeImage } from "./analysis";
import { DISH_RECIPE_ID } from "./dish-recipe";
import {
  type CanonicalImage,
  canonicalImageSize,
  canonicalize,
} from "./ingest";
import { imageBlobKey } from "./keys";
import { lockImage } from "./lock";
import { prepareImagePreview } from "./preview";

/** A canonical image held independently of every dataset. */
interface StoredImage {
  digest: string;
  width: number;
  height: number;
  bytes: number;
}

function assertStorable(bytes: Uint8Array): void {
  if (bytes.byteLength === 0)
    throw new ImageSourceInvalidError("The image is empty");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageSourceInvalidError(
      `The image exceeds ${MAX_IMAGE_BYTES / (1024 * 1024)} MiB`,
    );
  }
}

/**
 * Records a canonical image without assigning it to a dataset. The digest
 * lock is also used by Blob collection: after the immutable object is
 * visible, a committed Image row either roots it or a later sweep removes it.
 */
async function recordImage(
  image: CanonicalImage,
  analysis: DishAnalysis | null,
  attemptedAt: Date | null,
  tx: Executor,
): Promise<StoredImage> {
  const { digest, bytes, width, height } = image;
  await lockImage(digest, tx);
  const receivedAt = await operationTime(tx);
  await tx
    .insert(images)
    .values({
      id: digest,
      width,
      height,
      bytes: bytes.byteLength,
      dishAnalysis: analysis,
      dishAnalysisAttemptedAt: attemptedAt,
      receivedAt,
    })
    .onConflictDoUpdate({
      target: images.id,
      set: {
        receivedAt,
        ...(analysis ? { dishAnalysis: analysis } : {}),
        ...(attemptedAt ? { dishAnalysisAttemptedAt: attemptedAt } : {}),
      },
    });
  await putImmutableBlob(imageBlobKey(digest), bytes);
  return { digest, width, height, bytes: bytes.byteLength };
}

/** Stores the canonical image a source encodes. */
export async function storeImage(source: Uint8Array): Promise<StoredImage> {
  assertStorable(source);
  const image = await canonicalize(source);
  assertStorable(image.bytes);
  return store(image);
}

/**
 * Stores bytes that are already a canonical image, as another workbench
 * exported them. They enter untouched, so the digest they were addressed by
 * there, and every annotation addressed by it, holds here too. Bytes that do
 * not hash to `digest` or are not the canonical encoding are refused.
 */
export async function storeCanonicalImage(
  digest: string,
  bytes: Uint8Array,
): Promise<StoredImage> {
  assertStorable(bytes);
  if (contentDigest(bytes) !== digest) {
    throw new ImageSourceInvalidError(`The bytes do not hash to ${digest}`);
  }
  const { width, height } = await canonicalImageSize(bytes);
  return store({ digest, bytes, width, height });
}

const storing = createSingleFlight<StoredImage>();

/** Repeated uploads reuse completed analysis, including a successful no-candidate result. */
function store(image: CanonicalImage): Promise<StoredImage> {
  return storing(image.digest, async () => {
    const [existing] = await (
      await database()
    )
      .select({ analysis: images.dishAnalysis })
      .from(images)
      .where(eq(images.id, image.digest));
    const current = existing?.analysis?.recipe === DISH_RECIPE_ID;
    const analysis = current ? existing.analysis : await analyzeImage(image);
    const attemptedAt = current ? null : new Date();
    const stored = await transaction((tx) =>
      recordImage(image, analysis, attemptedAt, tx),
    );
    await prepareImagePreview(image.digest);
    return stored;
  });
}
