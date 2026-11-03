import { z } from "zod";

/** A resource id, unanchored, as an HTML `pattern` attribute takes it. */
export const RESOURCE_ID_PATTERN = "[A-Za-z0-9][A-Za-z0-9._-]{0,127}";

export const resourceIdSchema = z
  .string()
  .regex(new RegExp(`^${RESOURCE_ID_PATTERN}$`));

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * A generated identifier, a kind's prefix and a UUID or a digest, read by
 * the first eight digits of its generated part; a declared identifier, such
 * as `traditional-v1`, reads whole.
 */
const GENERATED_ID = /^[a-z]+-([0-9a-f-]{32,})$/;

export function identifierLabel(id: string): string {
  const generated = GENERATED_ID.exec(id)?.[1];
  return generated ? generated.replaceAll("-", "").slice(0, 8) : id;
}
