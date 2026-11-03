import { NotFoundError, ConflictError, ValidationError } from "../errors";

export class DatasetNotFoundError extends NotFoundError {
  readonly code = "dataset_not_found";
}
export class DatasetModelError extends ConflictError {
  readonly code = "dataset_model_mismatch";
}
export class DatasetImportError extends ValidationError {
  readonly code = "dataset_import_invalid";
}
export class DatasetNameTakenError extends ConflictError {
  readonly code = "dataset_name_taken";
}
