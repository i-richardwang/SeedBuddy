import {
  artifactUploadSchema,
  artifactPartSize,
  type ArtifactUpload,
} from "../../domain/training/artifact";
import { resourceIdSchema } from "../../domain/identifiers/schema";

export function artifactPartKey(
  runId: string,
  attempt: number,
  upload: ArtifactUpload,
  part: number,
): string {
  return `training-artifact-parts/${runId}/${attempt}/${upload.digest}/${upload.bytes}/${part}`;
}

export function parseArtifactPartKey(key: string) {
  const [prefix, runId, attemptText, digest, bytes, partText, extra] =
    key.split("/");
  const parsedRunId = resourceIdSchema.safeParse(runId);
  const attempt = Number(attemptText);
  const part = Number(partText);
  const upload = artifactUploadSchema.safeParse({
    digest,
    bytes: Number(bytes),
  });
  if (
    prefix !== "training-artifact-parts" ||
    extra !== undefined ||
    !parsedRunId.success ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    !upload.success ||
    !artifactPartSize(upload.data, part) ||
    key !== artifactPartKey(parsedRunId.data, attempt, upload.data, part)
  )
    return null;
  return {
    trainingRunId: parsedRunId.data,
    trainingAttempt: attempt,
    upload: upload.data,
    part,
  };
}
