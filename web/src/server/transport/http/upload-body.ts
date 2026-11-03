/** Uploads answer refusals as { error: string }. */
export function uploadFailure(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** A bounded body containing exactly its declared number of bytes. */
export async function exactLengthBody(
  request: Request,
  maxBytes: number,
  excessLengthStatus: 400 | 413 = 413,
): Promise<Uint8Array | Response> {
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0)
    return uploadFailure("Content-Length is required", 411);
  if (length > maxBytes)
    return uploadFailure(`Body exceeds ${maxBytes / (1024 * 1024)} MiB`, 413);
  if (!request.body) return uploadFailure("Body is required", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > length) {
        await reader.cancel();
        return uploadFailure("Body exceeds Content-Length", excessLengthStatus);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== length)
    return uploadFailure("Body differs from Content-Length", 400);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
