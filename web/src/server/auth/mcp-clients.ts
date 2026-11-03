import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { McpClientNotFoundError } from "../../domain/auth/errors";
import {
  MCP_SERVERS,
  type McpClient,
  mcpClientSchema,
} from "../../domain/auth/integrations";
import { database, transaction } from "../infra/db/client";
import {
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} from "../infra/db/schema";
import { deploymentEndpoint } from "../infra/deployment";

/**
 * The MCP clients an account has authorized. A consent is what the OAuth
 * server checks before issuing a code without asking again. The MCP resource
 * server checks the same consent on every request.
 *
 * A consent records the servers of the client's latest approval only, while
 * its earlier grants live on in their refresh tokens; together they name every
 * server the client can reach.
 */

/** The clients `user` has approved, most recently approved first. */
export async function listMcpClients(user: string): Promise<McpClient[]> {
  const db = await database();
  const rows = await db
    .select({
      id: oauthConsents.id,
      clientId: oauthConsents.clientId,
      name: oauthClients.name,
      resources: oauthConsents.resources,
      createdAt: oauthConsents.createdAt,
      updatedAt: oauthConsents.updatedAt,
    })
    .from(oauthConsents)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
    .where(eq(oauthConsents.userId, user))
    .orderBy(desc(oauthConsents.updatedAt));
  const grants = await db
    .select({
      clientId: oauthRefreshTokens.clientId,
      resources: oauthRefreshTokens.resources,
    })
    .from(oauthRefreshTokens)
    .where(
      and(
        eq(oauthRefreshTokens.userId, user),
        isNull(oauthRefreshTokens.revoked),
        gt(oauthRefreshTokens.expiresAt, new Date()),
      ),
    );
  const { mcpResources } = deploymentEndpoint();
  const servers = (clientId: string, consented: string[] | null) => {
    const resources = new Set([
      ...(consented ?? []),
      ...grants
        .filter((grant) => grant.clientId === clientId)
        .flatMap((grant) => grant.resources ?? []),
    ]);
    return MCP_SERVERS.filter((name) => resources.has(mcpResources[name]));
  };
  return rows.map((row) =>
    mcpClientSchema.parse({
      id: row.id,
      clientId: row.clientId,
      name: row.name ?? row.clientId,
      servers: servers(row.clientId, row.resources),
      grantedAt: row.createdAt.toISOString(),
      lastGrantedAt: row.updatedAt.toISOString(),
    }),
  );
}

/** Withdraw consent and every refresh path for one of `user`'s clients. */
export async function disconnectMcpClient(
  user: string,
  id: string,
): Promise<void> {
  await transaction(async (tx) => {
    const [consent] = await tx
      .delete(oauthConsents)
      .where(and(eq(oauthConsents.id, id), eq(oauthConsents.userId, user)))
      .returning({ clientId: oauthConsents.clientId });
    if (!consent) {
      throw new McpClientNotFoundError(`Unknown MCP client: ${id}`);
    }
    const now = new Date();
    await tx
      .update(oauthRefreshTokens)
      .set({ revoked: now })
      .where(
        and(
          eq(oauthRefreshTokens.userId, user),
          eq(oauthRefreshTokens.clientId, consent.clientId),
          isNull(oauthRefreshTokens.revoked),
        ),
      );
  });
}
