import { ConflictError, NotFoundError, ValidationError } from "../errors";

export class ModelNotFoundError extends NotFoundError {
  readonly code = "model_not_found";
}
export class ModelVersionNotFoundError extends NotFoundError {
  readonly code = "model_version_not_found";
}
/** Identifiers are how every record names its model, so two tasks cannot share one. */
export class ModelIdTakenError extends ConflictError {
  readonly code = "model_id_taken";
}
export class ModelInUseError extends ConflictError {
  readonly code = "model_in_use";
}
/** Boxes, or the classes an observation counts, name a class the model does not declare. */
export class UnknownClassError extends ValidationError {
  readonly code = "class_invalid";
}

export class ModelPublicationError extends ValidationError {
  readonly code = "model_publication_invalid";
}
