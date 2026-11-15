import { ConflictError, NotFoundError } from "../errors";

export class WorkerNotFoundError extends NotFoundError {
  readonly code = "worker_not_found";
}

export class WorkerNameTakenError extends ConflictError {
  readonly code = "worker_name_taken";
}

export class WorkerSessionConflictError extends ConflictError {
  readonly code = "worker_session_conflict";
}

/** A personal worker takes training only from the account it belongs to. */
export class WorkerOwnerConflictError extends ConflictError {
  readonly code = "worker_owner_conflict";
}
