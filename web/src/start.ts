import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";

import { loginPath, requestedPath } from "./domain/auth/navigation";
import { mapBusinessErrors } from "./functions/errors";
import { apiRequestAuthorization } from "./server/transport/http/authorization";
import { withRequestLocale } from "./server/transport/http/locale";
import { readSession, redirect } from "./server/transport/http/session";

/**
 * Paths that answer without a browser session: readiness, sign-in, the auth
 * API with its OAuth discovery documents, the agent API, which resolves the
 * account behind the API key it is given, the worker API, whose parent route
 * admits only an enrolled worker's token, and the two MCP servers, which
 * verify their credentials themselves so they can issue the discovery
 * challenge.
 */
function answersForItself(pathname: string): boolean {
  return (
    pathname === "/healthz" ||
    pathname === "/login" ||
    pathname === "/api/experiments/mcp" ||
    pathname === "/api/annotation/mcp" ||
    pathname.startsWith("/api/agent/") ||
    pathname.startsWith("/api/worker/") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/.well-known/")
  );
}

const requireSession = createMiddleware().server(
  async ({ request, pathname, handlerType, next }) => {
    if (answersForItself(pathname)) {
      return next();
    }
    const bearerRealm = await apiRequestAuthorization(pathname, request);
    if (bearerRealm !== null) {
      return bearerRealm
        ? next()
        : new Response("Unauthorized", { status: 401 });
    }
    if (await readSession(request.headers)) {
      return next();
    }
    if (handlerType === "serverFn" || pathname.startsWith("/api/")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return redirect(loginPath(requestedPath(request)));
  },
);

const resolveLocale = createMiddleware().server(({ request, next }) =>
  withRequestLocale(request, () => next()),
);

const requireSameOriginServerFunction = createCsrfMiddleware({
  filter: ({ handlerType }) => handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [mapBusinessErrors],
  requestMiddleware: [
    requireSameOriginServerFunction,
    resolveLocale,
    requireSession,
  ],
}));
