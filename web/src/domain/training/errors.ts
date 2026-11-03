import { ConflictError, NotFoundError, ValidationError } from "../errors";

export class TrainingRunConflictError extends ConflictError {
  readonly code = "training_run_conflict";
}
export class TrainingRunNotFoundError extends NotFoundError {
  readonly code = "training_run_not_found";
}
export class TrainingArtifactValidationError extends ValidationError {
  readonly code = "training_artifact_invalid";
}
