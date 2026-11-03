import { ConflictError, NotFoundError, ValidationError } from "../errors";

export class DatasetNotFoundError extends NotFoundError {
  readonly code = "dataset_not_found";
}
export class DatasetModelMismatchError extends ValidationError {
  readonly code = "dataset_model_mismatch";
}
export class DatasetImportInvalidError extends ValidationError {
  readonly code = "dataset_import_invalid";
}
export class DatasetNameTakenError extends ConflictError {
  readonly code = "dataset_name_taken";
}

export class DatasetManifestTooLargeError extends ValidationError {
  readonly code = "dataset_manifest_too_large";
}
