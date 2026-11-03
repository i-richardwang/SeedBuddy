import type { sourceImageFileError } from "../../domain/images/canonical";
import { m } from "../../paraglide/messages";

const FILE_ERRORS = {
  unsupported: m.image_file_unsupported,
  empty: m.image_file_empty,
  too_large: m.image_file_too_large,
} as const satisfies Record<
  NonNullable<ReturnType<typeof sourceImageFileError>>,
  () => string
>;

export function imageFileErrorLabel(
  error: NonNullable<ReturnType<typeof sourceImageFileError>>,
): string {
  return FILE_ERRORS[error]();
}
