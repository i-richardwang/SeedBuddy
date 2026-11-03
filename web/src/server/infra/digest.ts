import { createHash } from "node:crypto";

import { canonicalJson } from "../../lib/json/canonical";

/** The SHA-256 digest that identifies content, as lower-case hex. */
export function contentDigest(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** A document's identity is independent of object key order. */
export function documentDigest(value: unknown): string {
  return contentDigest(canonicalJson(value));
}
