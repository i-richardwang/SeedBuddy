/** Uploads answer refusals as { error: string }. */
export function uploadFailure(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** A bounded body containing exactly its declared number of bytes. */
export async function exactLengthBody(
  request: Request,
  maxBytes: number,
  refuse: (message: string, status: number) => Response = uploadFailure,
): Promise<Uint8Array | Response> {
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0)
    return refuse("Content-Length is required", 411);
  if (length > maxBytes)
    return refuse(`Body exceeds ${maxBytes / (1024 * 1024)} MiB`, 413);
  if (!request.body) return refuse("Body is required", 400);
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
        return refuse("Body exceeds Content-Length", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== length) return refuse("Body differs from Content-Length", 400);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
