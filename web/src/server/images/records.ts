import { eq } from "drizzle-orm";

import { ImageNotFoundError } from "../../domain/images/errors";
import type { Executor } from "../infra/db/client";
import { images } from "../infra/db/schema";

/** The stored canonical image, or the same refusal wherever it is requested. */
export async function requireStoredImage(digest: string, db: Executor) {
  const [image] = await db.select().from(images).where(eq(images.id, digest));
  if (!image) throw new ImageNotFoundError(`Unknown image: ${digest}`);
  return image;
}
