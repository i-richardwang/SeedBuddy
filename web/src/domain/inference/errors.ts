import { ConflictError, NotFoundError, ValidationError } from "../errors";

export class DetectionConflictError extends ConflictError {
  readonly code = "detection_conflict";
  constructor({ versionId, digest }: { versionId: string; digest: string }) {
    super(`${versionId} already detected ${digest} with a different result`);
  }
}
export class InvalidDetectionOutcomeError extends ValidationError {
  readonly code = "detection_outcome_invalid";
}
export class DetectionImageNotFoundError extends NotFoundError {
  readonly code = "detection_image_not_found";
}
export class ProducerMismatchError extends ValidationError {
  readonly code = "producer_mismatch";
}
export class InferenceAttemptConflictError extends ConflictError {
  readonly code = "inference_attempt_conflict";
}
