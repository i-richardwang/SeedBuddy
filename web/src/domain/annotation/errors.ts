import { ConflictError } from "../errors";

export class AnnotationConflictError extends ConflictError {
  readonly code = "annotation_conflict";
  constructor() {
    super("The annotation changed after this draft was opened");
  }
}
