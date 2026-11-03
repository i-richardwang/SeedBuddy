import { ConflictError, NotFoundError } from "../errors";

export class WorkerNotFoundError extends NotFoundError {
  readonly code = "worker_not_found";
}

export class WorkerAlreadyEnrolledError extends ConflictError {
  readonly code = "worker_name_taken";
}

export class WorkerSessionConflictError extends ConflictError {
  readonly code = "worker_session_conflict";
}
