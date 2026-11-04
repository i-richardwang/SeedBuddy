import "./scripts/image-analysis-runtime";
import { resolve } from "node:path";

import handler from "./dist/server/server.js";
import { MAX_MODEL_ARTIFACT_REQUEST_BYTES } from "./src/domain/models/transfer";

const CLIENT_DIR = `${process.cwd()}/dist/client`;
const port = Number(process.env.PORT ?? 3000);

// Reach the database and the blob store before accepting traffic, so a bad
// DATABASE_URL or blob-store configuration fails the start rather than a request.
const health = await handler.fetch(new Request("http://localhost/healthz"));
if (!health.ok) {
  throw new Error(`Server is not ready: ${await health.text()}`);
}

Bun.serve({
  port,
  maxRequestBodySize: MAX_MODEL_ARTIFACT_REQUEST_BYTES,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" || request.method === "HEAD") {
      const path = resolve(CLIENT_DIR, `.${pathname}`);
      const asset = Bun.file(path);
      if (path.startsWith(`${CLIENT_DIR}/`) && (await asset.exists())) {
        return new Response(asset, {
          headers: {
            "Cache-Control": pathname.startsWith("/assets/")
              ? "public, max-age=31536000, immutable"
              : "public, max-age=3600",
            "Content-Type": asset.type,
          },
        });
      }
    }
    return handler.fetch(request);
  },
});

console.log(`VitroFlow workbench listening on http://localhost:${port}`);
