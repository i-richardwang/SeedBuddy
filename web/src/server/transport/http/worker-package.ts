import type { WorkerPackage } from "../../workers/public";

/**
 * Serves the worker package this workbench ships under its wheel name. The
 * name stays the same from one deployment to the next while the content
 * changes, so the answer carries the content's digest as its entity tag and
 * an installer's cache revalidates it rather than reusing it.
 */
export function workerPackageResponse(
  shipped: WorkerPackage | null,
  filename: string,
  request: Request,
): Response {
  if (shipped?.filename !== filename)
    return new Response("No such worker package", { status: 404 });
  const headers = {
    "Cache-Control": "no-cache",
    ETag: `"${shipped.digest}"`,
  };
  if (request.headers.get("If-None-Match") === headers.ETag)
    return new Response(null, { status: 304, headers });
  return new Response(shipped.content, {
    headers: {
      ...headers,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(shipped.content.byteLength),
    },
  });
}
