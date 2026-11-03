/**
 * Postgres reports the broken constraint on the driver error under the wrapper;
 * the deployed driver names the field `constraint_name` and PGlite `constraint`.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause as
    | { code?: string; constraint?: string; constraint_name?: string }
    | undefined;
  return (
    cause?.code === "23505" &&
    (cause.constraint ?? cause.constraint_name) === constraint
  );
}

/** Translate only the named uniqueness constraint; preserve other failures. */
export async function refusingUnique<T>(
  constraint: string,
  refusal: () => Error,
  write: () => PromiseLike<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!isUniqueViolation(error, constraint)) throw error;
    throw refusal();
  }
}
