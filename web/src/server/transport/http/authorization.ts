import { apiKeyPrincipal, bearerToken } from "../../auth/public";

/**
 * Whether the transfer API admits the request: an account opens it with a
 * personal API key issued for transfers. Null when the browser session
 * decides, on any other path or when the request presents no key.
 */
export async function apiRequestAuthorization(
  pathname: string,
  request: Request,
): Promise<boolean | null> {
  if (!pathname.startsWith("/api/transfer/") || bearerToken(request) === null) {
    return null;
  }
  return (await apiKeyPrincipal(request, "transfer")) !== null;
}
