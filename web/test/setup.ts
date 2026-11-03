import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const messagesOutput = new URL("../src/paraglide/messages.js", import.meta.url);
const compiledAt =
  statSync(messagesOutput, { throwIfNoEntry: false })?.mtimeMs ?? 0;
const messageInputs = new Bun.Glob(
  "{messages/**/*.json,project.inlang/settings.json,paraglide.config.ts,scripts/compile-messages.ts,package.json,bun.lock}",
);
if (
  !compiledAt ||
  [...messageInputs.scanSync({ cwd: webRoot, absolute: true })].some(
    (path) => statSync(path).mtimeMs > compiledAt,
  )
) {
  const compile = Bun.spawn([process.execPath, "scripts/compile-messages.ts"], {
    cwd: webRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await compile.exited) !== 0)
    throw new Error("Message compilation failed");
}

process.env.VITROFLOW_IMAGE_ANALYSIS_URL = new URL(
  "../src/server/images/dish-thread.ts",
  import.meta.url,
).href;

import { auth } from "../src/server/auth/public";
import { bootstrap } from "../src/server/bootstrap";

process.env.DATABASE_URL =
  process.env.VITROFLOW_TEST_DATABASE_URL ?? "pglite://";
process.env.VITROFLOW_BLOB_ENDPOINT = "memory://";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";
for (const credential of [
  "VITROFLOW_ADMIN_EMAIL",
  "VITROFLOW_ADMIN_PASSWORD",
  "VITROFLOW_WORKER_TOKEN",
]) {
  delete process.env[credential];
}

bootstrap();

/**
 * The auth API listens on a loopback port for the whole run: the MCP endpoint
 * verifies access tokens against the JWKS it fetches from the public origin,
 * and OAuth clients in tests reach the authorization server the same way.
 */
const authServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => (await auth()).handler(request),
});
process.env.BETTER_AUTH_URL = `http://localhost:${authServer.port}`;
