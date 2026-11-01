import type { TrainingAttemptOwner } from "../../domain/training/schema";
import { TrainingArtifactValidationError } from "../../domain/training/errors";
import {
  artifactUploadSchema,
  artifactPartSize,
  TRAINING_ARTIFACT_PART_BYTES,
  type ArtifactUpload,
} from "../../domain/training/artifact";
import { database } from "../infra/db/client";
import {
  putImmutableBlob,
  readBlob,
  ImmutableBlobConflictError,
} from "../infra/blobs/store";
import { contentDigest } from "../infra/digest";
import { readTrainingRun, requireOwnedRunningRun } from "./runs";
import { artifactPartKey } from "./keys";

export async function saveTrainingArtifactPart(
  runId: string,
  owner: TrainingAttemptOwner,
  upload: ArtifactUpload,
  part: number,
  digest: string,
  bytes: Uint8Array,
) {
  if (!artifactUploadSchema.safeParse(upload).success)
    throw new TrainingArtifactValidationError("Invalid artifact upload");
  const db = await database();
  await requireOwnedRunningRun(
    runId,
    await readTrainingRun(runId, db),
    owner,
    db,
  );
  const expected = artifactPartSize(upload, part);
  if (
    !expected ||
    bytes.byteLength !== expected ||
    contentDigest(bytes) !== digest
  )
    throw new TrainingArtifactValidationError(
      "Artifact part size or digest does not match",
    );
  try {
    await putImmutableBlob(
      artifactPartKey(runId, owner.attempt, upload, part),
      bytes,
    );
  } catch (error) {
    if (error instanceof ImmutableBlobConflictError)
      throw new TrainingArtifactValidationError(
        "Artifact part already has different contents",
      );
    throw error;
  }
}

/** Assemble verified final weights; no model is published before every part is present. */
export async function readTrainingArtifactParts(
  runId: string,
  owner: TrainingAttemptOwner,
  upload: ArtifactUpload,
) {
  const bytes = new Uint8Array(upload.bytes);
  for (
    let part = 0;
    part < Math.ceil(upload.bytes / TRAINING_ARTIFACT_PART_BYTES);
    part++
  ) {
    const chunk = await readBlob(
      artifactPartKey(runId, owner.attempt, upload, part),
    );
    if (!chunk || chunk.byteLength !== artifactPartSize(upload, part))
      throw new TrainingArtifactValidationError(
        `Artifact part ${part} is missing or incomplete`,
      );
    bytes.set(chunk, part * TRAINING_ARTIFACT_PART_BYTES);
  }
  if (contentDigest(bytes) !== upload.digest)
    throw new TrainingArtifactValidationError("Artifact digest does not match");
  return bytes;
}
