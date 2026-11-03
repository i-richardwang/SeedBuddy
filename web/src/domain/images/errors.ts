import { NotFoundError, ValidationError } from "../errors";

/** No image with the digest is stored. */
export class ImageNotFoundError extends NotFoundError {
  readonly code = "image_not_found";
}

export class ImageSourceInvalidError extends ValidationError {
  readonly code = "image_source_invalid";
}
