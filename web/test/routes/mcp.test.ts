import { expect, test } from "bun:test";

import { Route as DiscoveryRoute } from "../../src/routes/[.]well-known.$";
import { Route as AnnotationRoute } from "../../src/routes/api.annotation.mcp";
import { Route as ExperimentsRoute } from "../../src/routes/api.experiments.mcp";
import {
  disconnectMcpClient,
  listMcpClients,
} from "../../src/server/auth/mcp-clients";
import { authorizeMcpClient, signInAs } from "../../src/server/testing/auth";

type HttpHandler = (context: { request: Request }) => Promise<Response>;

for (const [server, route] of [
  ["annotation", AnnotationRoute],
  ["experiments", ExperimentsRoute],
] as const) {
  const endpoint = () => `${process.env.BETTER_AUTH_URL}/api/${server}/mcp`;
  const request = (method: string, token?: string) =>
    new Request(endpoint(), {
      method,
      headers: {
        host: new URL(endpoint()).host,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  const handle = (request: Request) => {
    const handlers = route.options.server?.handlers as
      { ANY?: HttpHandler } | undefined;
    if (!handlers?.ANY) throw new Error(`${server} has no MCP HTTP handler`);
    return handlers.ANY({ request });
  };

  test(`${server} GET probe discovers OAuth before client registration`, async () => {
    const response = await handle(request("GET"));
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    const metadataUrl = challenge.match(/resource_metadata="([^"]+)"/)?.[1];
    expect(metadataUrl).toBe(
      `${process.env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource/api/${server}/mcp`,
    );

    const discovery = DiscoveryRoute.options.server?.handlers as {
      GET: HttpHandler;
    };
    const resourceResponse = await discovery.GET({
      request: new Request(metadataUrl!),
    });
    expect(resourceResponse.status).toBe(200);
    const resource = await resourceResponse.json();
    expect(resource.resource).toBe(endpoint());
    expect(resource.authorization_servers).toEqual([
      `${process.env.BETTER_AUTH_URL}/api/auth`,
    ]);

    const issuer = new URL(resource.authorization_servers[0]);
    const authorizationResponse = await discovery.GET({
      request: new Request(
        `${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`,
      ),
    });
    expect(authorizationResponse.status).toBe(200);
    const authorization = await authorizationResponse.json();
    expect(authorization.issuer).toBe(issuer.href);
    expect(authorization.registration_endpoint).toBe(
      `${issuer.href}/oauth2/register`,
    );
    expect(authorization.client_id_metadata_document_supported).toBe(true);
    expect(authorization.token_endpoint_auth_methods_supported).toContain(
      "none",
    );
  });

  test(`${server} authenticates unsupported methods before refusing transport access`, async () => {
    const { user, headers } = await signInAs("member");
    const { accessToken } = await authorizeMcpClient(headers, { server });
    for (const method of ["GET", "HEAD", "DELETE", "PUT", "PATCH", "OPTIONS"]) {
      expect((await handle(request(method))).status).toBe(401);
      expect((await handle(request(method, "forged"))).status).toBe(401);
      const response = await handle(request(method, accessToken));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
    }

    const foreignOrigin = request("GET", accessToken);
    foreignOrigin.headers.set("origin", "https://foreign.example");
    expect((await handle(foreignOrigin)).status).toBe(403);

    const [client] = await listMcpClients(user.id);
    await disconnectMcpClient(user.id, client.id);
    const revoked = await handle(request("GET", accessToken));
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toContain(
      `resource_metadata="${process.env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource/api/${server}/mcp"`,
    );
  });
}
