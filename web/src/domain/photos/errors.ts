import { NotFoundError } from "../errors";

/** No batch of this account's has the id: another account's batch is as absent as none. */
export class PhotoBatchNotFoundError extends NotFoundError {
  readonly code = "photo_batch_not_found";
}
