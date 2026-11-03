/** Model metadata and weight transfers have explicit admission limits. */
export const MAX_MODEL_WEIGHTS_BYTES = 512 * 1024 * 1024;
export const MAX_MODEL_MANIFEST_BYTES = 1024 * 1024;
/** The process-wide request body ceiling consumed by the Bun server entry. */
export const MAX_MODEL_ARTIFACT_REQUEST_BYTES =
  MAX_MODEL_WEIGHTS_BYTES + MAX_MODEL_MANIFEST_BYTES + 1024 * 1024;
