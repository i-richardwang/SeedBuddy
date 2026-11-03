import {
  type ArtifactUpload,
  artifactPartSize,
  artifactUploadSchema,
  TRAINING_ARTIFACT_PART_BYTES,
} from "../../domain/training/artifact";
import { TrainingArtifactInvalidError } from "../../domain/training/errors";
import type { AttemptOwner } from "../../domain/workers/schema";
import {
  ImmutableBlobConflictError,
  putImmutableBlob,
  readBlob,
} from "../infra/blobs/store";
import { database } from "../infra/db/client";
import { contentDigest } from "../infra/digest";
import { artifactPartKey } from "./keys";
import { requireOwnedRunningRun, requireTrainingRun } from "./ownership";

export async function saveTrainingArtifactPart(
  runId: string,
  owner: AttemptOwner,
  upload: ArtifactUpload,
  part: number,
  digest: string,
  bytes: Uint8Array,
) {
  if (!artifactUploadSchema.safeParse(upload).success)
    throw new TrainingArtifactInvalidError("Invalid artifact upload");
  const db = await database();
  await requireOwnedRunningRun(await requireTrainingRun(runId, db), owner, db);
  const expected = artifactPartSize(upload, part);
  if (
    !expected ||
    bytes.byteLength !== expected ||
    contentDigest(bytes) !== digest
  )
    throw new TrainingArtifactInvalidError(
      "Artifact part size or digest does not match",
    );
  try {
    await putImmutableBlob(
      artifactPartKey(runId, owner.attempt, upload, part),
      bytes,
    );
  } catch (error) {
    if (error instanceof ImmutableBlobConflictError)
      throw new TrainingArtifactInvalidError(
        "Artifact part already has different contents",
      );
    throw error;
  }
}

/** Assemble verified final weights; no model is published before every part is present. */
export async function readTrainingArtifactParts(
  runId: string,
  owner: AttemptOwner,
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
      throw new TrainingArtifactInvalidError(
        `Artifact part ${part} is missing or incomplete`,
      );
    bytes.set(chunk, part * TRAINING_ARTIFACT_PART_BYTES);
  }
  if (contentDigest(bytes) !== upload.digest)
    throw new TrainingArtifactInvalidError("Artifact digest does not match");
  return bytes;
}
