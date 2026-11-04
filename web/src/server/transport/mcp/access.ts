import { requireMcpAuth } from "@better-auth/mcp";
import {
  bearerAuthChallengeResponse,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  OAuthError,
  OAuthErrorCode,
  originValidationResponse,
} from "@modelcontextprotocol/server";

import {
  API_KEY_PREFIX,
  type McpServerName,
} from "../../../domain/auth/integrations";
import {
  auth,
  authorizeApiKey,
  bearerToken,
  mcpAuthorizationIsLive,
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

type AdmittedHandler = (request: Request) => Promise<Response>;

/**
 * One MCP server behind its two credentials. A client an account approved
 * presents an OAuth access token bound to that server's resource; a script or
 * an agent configured by hand presents a personal API key holding the scope
 * named after the server. Any other request is answered with the RFC 9728
 * challenge that points clients at the authorization server.
 */
export async function serveAuthorized(
  server: McpServerName,
  request: Request,
  handle: AdmittedHandler,
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
  const admit = async (accepted: Request): Promise<Response> =>
    rejectUnsupportedMcpMethod(accepted) ?? handle(accepted);

  if (bearerToken(request)?.startsWith(API_KEY_PREFIX)) {
    return (await authorizeApiKey(request, server))
      ? admit(request)
      : refuse("The API key is not active or does not open this MCP server");
  }
  return requireMcpAuth(
    await auth(),
    async (accepted, claims) =>
      (await mcpAuthorizationIsLive(claims))
        ? admit(accepted)
        : refuse("The account or MCP authorization is no longer active"),
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
