import { z } from "zod";

export const businessFailureSchema = z.strictObject({
  kind: z.literal("business_failure"),
  code: z.string().min(1),
  category: z.enum(["not_found", "conflict", "invalid_request"]),
  details: z.record(z.string(), z.json()),
});
export type BusinessFailure = z.infer<typeof businessFailureSchema>;

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly category: BusinessFailure["category"];
  get details(): BusinessFailure["details"] {
    return {};
  }
}
export abstract class NotFoundError extends DomainError {
  readonly category = "not_found" as const;
}
export abstract class ConflictError extends DomainError {
  readonly category = "conflict" as const;
}
export abstract class ValidationError extends DomainError {
  readonly category = "invalid_request" as const;
}

/** Expected refusals cross RPC as data, independent of Error serialization. */
export function businessFailure(error: DomainError): BusinessFailure {
  return {
    kind: "business_failure",
    code: error.code,
    category: error.category,
    details: error.details,
  };
}

export function failureCategory(
  error: unknown,
): BusinessFailure["category"] | null {
  return error instanceof DomainError ? error.category : null;
}
