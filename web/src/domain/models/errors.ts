import { ConflictError, NotFoundError, ValidationError } from "../errors";

export class ModelNotFoundError extends NotFoundError {
  readonly code = "model_not_found";
}
export class ModelUploadNotFoundError extends NotFoundError {
  readonly code = "model_upload_not_found";
}
export class ModelVersionNotFoundError extends NotFoundError {
  readonly code = "model_version_not_found";
}
/** Identifiers are how every record names its model, so two tasks cannot share one. */
export class ModelNameTakenError extends ConflictError {
  readonly code = "model_name_taken";
}
export class ModelUsageConflictError extends ConflictError {
  readonly code = "model_usage_conflict";
}
/** Boxes, or the classes an observation counts, name a class the model does not declare. */
export class ClassInvalidError extends ValidationError {
  readonly code = "class_invalid";
}

export class ModelPublicationInvalidError extends ValidationError {
  readonly code = "model_publication_invalid";
}
