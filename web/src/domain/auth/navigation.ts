const DEFAULT_RETURN_PATH = "/";
const AUTH_PATHS = new Set(["/login"]);

/** A browser destination that stays inside the workbench and outside auth. */
export function returnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return DEFAULT_RETURN_PATH;
  }
  const destination = new URL(value, "http://seedbuddy.local");
  if (AUTH_PATHS.has(destination.pathname)) return DEFAULT_RETURN_PATH;
  return `${destination.pathname}${destination.search}`;
}

export function loginPath(destination: unknown): string {
  const target = returnPath(destination);
  if (target === DEFAULT_RETURN_PATH) return "/login";
  return `/login?${new URLSearchParams({ returnTo: target })}`;
}

export function requestedPath(request: Request): string {
  const { pathname, search } = new URL(request.url);
  return returnPath(`${pathname}${search}`);
}

/**
 * Whether a page's query is a signed OAuth authorization request: the
 * authorization server sends the browser to sign in or consent with the
 * request it must resume, and the page keeps that request in its URL.
 */
export function carriesAuthorizationRequest(search: URLSearchParams): boolean {
  return search.has("client_id") && search.has("sig");
}
