import { z } from "zod";
import { MAX_MODEL_WEIGHTS_BYTES } from "../models/transfer";
import { sha256Schema } from "../identifiers/schema";

/** Fixed wire size, shared with vitroctl.worker.training. */
export const TRAINING_ARTIFACT_PART_BYTES = 8 * 1024 * 1024;

export const artifactUploadSchema = z.strictObject({
  bytes: z.number().int().positive().max(MAX_MODEL_WEIGHTS_BYTES),
  digest: sha256Schema,
});

export type ArtifactUpload = z.infer<typeof artifactUploadSchema>;

export function artifactPartSize(upload: ArtifactUpload, part: number) {
  if (
    !Number.isInteger(part) ||
    part < 0 ||
    part >= Math.ceil(upload.bytes / TRAINING_ARTIFACT_PART_BYTES)
  )
    return 0;
  return Math.min(
    TRAINING_ARTIFACT_PART_BYTES,
    upload.bytes - part * TRAINING_ARTIFACT_PART_BYTES,
  );
}
