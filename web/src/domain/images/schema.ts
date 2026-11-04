import { z } from "zod";

import { sha256Schema } from "../identifiers/schema";

/**
 * An image is identified by the SHA-256 digest of its bytes everywhere: in
 * the database, in blob storage, in documents, and in URLs. Experiments and
 * datasets refer to images; they do not own them.
 */
export const imageDigestSchema = sha256Schema;

/** One stored image, by digest: what an upload answers, and what a request names. */
export const imageRefSchema = z.strictObject({
  digest: imageDigestSchema,
});

export type ImageRef = z.infer<typeof imageRefSchema>;

/** The pixel coordinate frame of one canonical image. */
export const imageFrameSchema = imageRefSchema.extend({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
