import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { APIError } from "better-auth/api";
import { z } from "zod";

import {
  apiKeyCreateSchema,
  apiKeyRefSchema,
  MCP_SERVERS,
  mcpClientRefSchema,
} from "../domain/auth/integrations";
import {
  auth,
  disconnectMcpClient,
  issueApiKey,
  listApiKeys,
  listMcpClients,
  revokeApiKey,
} from "../server/auth/public";
import { deploymentEndpoint } from "../server/infra/deployment";
import { requireAccount } from "./access";

export const getIntegrations = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = (await requireAccount()).id;
    const [apiKeys, mcpClients] = await Promise.all([
      listApiKeys(user),
      listMcpClients(user),
    ]);
    return {
      apiKeys,
      mcpClients,
      mcpUrls: deploymentEndpoint().mcpResources,
    };
  },
);

export const addApiKey = createServerFn({ method: "POST" })
  .validator(apiKeyCreateSchema)
  .handler(async ({ data }) => issueApiKey((await requireAccount()).id, data));

export const removeApiKey = createServerFn({ method: "POST" })
  .validator(apiKeyRefSchema)
  .handler(async ({ data }) =>
    revokeApiKey((await requireAccount()).id, data.key),
  );

export const removeMcpClient = createServerFn({ method: "POST" })
  .validator(mcpClientRefSchema)
  .handler(async ({ data }) =>
    disconnectMcpClient((await requireAccount()).id, data.client),
  );

/**
 * The client named by an authorization request and the MCP servers it asks
 * for, as the consent page shows them.
 */
export const describeOAuthClient = createServerFn({ method: "GET" })
  .validator(
    z.strictObject({ clientId: z.string(), resources: z.array(z.string()) }),
  )
  .handler(async ({ data }) => {
    const { mcpResources } = deploymentEndpoint();
    const client = await (
      await auth()
    ).api
      .getOAuthClientPublic({
        query: { client_id: data.clientId },
        headers: getRequestHeaders(),
      })
      .catch((error: unknown) => {
        if (error instanceof APIError && error.statusCode === 404) {
          throw notFound();
        }
        throw error;
      });
    return {
      name: client.client_name ?? data.clientId,
      uri: client.client_uri ?? null,
      servers: MCP_SERVERS.filter((server) =>
        data.resources.includes(mcpResources[server]),
      ),
    };
  });
