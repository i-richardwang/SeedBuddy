import { requireMcpAuth } from "@better-auth/mcp";
import {
  type AuthInfo,
  bearerAuthChallengeResponse,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  type McpHttpHandler,
  OAuthError,
  OAuthErrorCode,
  originValidationResponse,
} from "@modelcontextprotocol/server";

import {
  API_KEY_PREFIX,
  type McpServerName,
  type Principal,
} from "../../../domain/auth/integrations";
import {
  apiKeyPrincipal,
  auth,
  bearerToken,
  mcpClientPrincipal,
} from "../../auth/public";
import { deploymentEndpoint } from "../../infra/deployment";

/**
 * MCP requests are accepted only for local development hostnames or the
 * public origin browsers reach the workbench at. Browser requests must also
 * carry an Origin from the same set; non-browser clients omit it.
 */
export function guardMcpRequest(request: Request): Response | null {
  const deployment = deploymentEndpoint();
  return (
    hostHeaderValidationResponse(request, [
      ...localhostAllowedHostnames(),
      deployment.hostname,
    ]) ??
    originValidationResponse(request, [
      ...localhostAllowedOrigins(),
      deployment.hostname,
    ]) ??
    null
  );
}

/**
 * Both MCP eras use POST only in this stateless deployment. Apply this after authentication:
 * unauthenticated clients still receive the protected-resource challenge,
 * while authorized GET/DELETE requests cannot open legacy streams or sessions.
 */
function rejectUnsupportedMcpMethod(request: Request): Response | null {
  return request.method === "POST"
    ? null
    : new Response(null, {
        status: 405,
        headers: { Allow: "POST", "Cache-Control": "no-store" },
      });
}

const METADATA_PATH = "/.well-known/oauth-protected-resource";

/**
 * The access token of a request whose token was verified, under either
 * scheme a client may use: Bearer, or DPoP for a token bound to the client's
 * key.
 */
function verifiedAccessToken(verified: Request): string {
  const [, token] = (verified.headers.get("authorization") ?? "")
    .trim()
    .split(/\s+/);
  if (!token) throw new Error("A verified request presents an access token");
  return token;
}

/** The account an admitted request acts for. */
export function admittedAccount(authInfo: AuthInfo | undefined): string {
  const user = authInfo?.extra?.user;
  if (typeof user !== "string")
    throw new Error("An MCP server serves admitted requests only");
  return user;
}

/**
 * One MCP server behind its two credentials. A client an account approved
 * presents an OAuth access token bound to that server's resource; a script or
 * an agent configured by hand presents a personal API key holding the scope
 * named after the server. Either way the request acts for that account, and
 * the server is handed what the credential proved in the record the SDK
 * surfaces to its tools: the token, the client it was issued to, the scopes
 * it holds and, as `extra.user`, the account. Any other request is answered
 * with the RFC 9728 challenge that points clients at the authorization
 * server.
 */
export async function serveAuthorized(
  server: McpServerName,
  request: Request,
  handler: Pick<McpHttpHandler, "fetch">,
): Promise<Response> {
  const deployment = deploymentEndpoint();
  const resource = deployment.mcpResources[server];
  const refuse = (message: string): Response =>
    bearerAuthChallengeResponse(
      new OAuthError(OAuthErrorCode.InvalidToken, message),
      {
        resourceMetadataUrl: `${deployment.origin}${METADATA_PATH}${new URL(resource).pathname}`,
      },
    );
  const admit = async (
    accepted: Request,
    principal: Principal | null,
    credential: Pick<AuthInfo, "token" | "scopes">,
    refusal: string,
  ): Promise<Response> => {
    if (principal === null) return refuse(refusal);
    return (
      rejectUnsupportedMcpMethod(accepted) ??
      handler.fetch(accepted, {
        authInfo: {
          ...credential,
          clientId: principal.client,
          extra: { user: principal.user },
        },
      })
    );
  };

  const key = bearerToken(request);
  if (key?.startsWith(API_KEY_PREFIX)) {
    return admit(
      request,
      await apiKeyPrincipal(request, server),
      { token: key, scopes: [server] },
      "The API key is not active or does not open this MCP server",
    );
  }
  return requireMcpAuth(
    await auth(),
    async (accepted, claims) =>
      admit(
        accepted,
        await mcpClientPrincipal(claims),
        {
          token: verifiedAccessToken(accepted),
          scopes:
            typeof claims.scope === "string" ? claims.scope.split(" ") : [],
        },
        "The account or MCP authorization is no longer active",
      ),
    { resource },
  )(request);
}

/**
 * RFC 9728 metadata for the annotation server. The authorization server
 * describes the experiment server it was configured with; the annotation
 * server shares everything but its resource identifier.
 */
export async function annotationResourceMetadata(
  request: Request,
): Promise<Response | null> {
  const { origin, mcpResources } = deploymentEndpoint();
  const annotation = new URL(mcpResources.annotation);
  if (
    new URL(request.url).pathname !== `${METADATA_PATH}${annotation.pathname}`
  )
    return null;
  const experiments = await (
    await auth()
  ).handler(
    new Request(
      `${origin}${METADATA_PATH}${new URL(mcpResources.experiments).pathname}`,
    ),
  );
  if (!experiments.ok) return experiments;
  const metadata = (await experiments.json()) as Record<string, unknown>;
  const headers = new Headers(experiments.headers);
  headers.delete("content-length");
  return new Response(
    request.method === "HEAD"
      ? null
      : JSON.stringify({ ...metadata, resource: mcpResources.annotation }),
    { headers },
  );
}
