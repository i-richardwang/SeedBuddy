import { z } from "zod";

import { timestampSchema } from "../time";

/**
 * Programmatic access to the workbench belongs to accounts. A personal API
 * key opens the surfaces its scopes name on behalf of the account that issued
 * it; an MCP client holds an OAuth grant the account approved on the consent
 * page. Both are listed and withdrawn on the Integrations page.
 */

/**
 * The workbench serves two MCP servers for two jobs: maintaining experiment
 * records, and drawing boxes on images. An agent is configured with the one
 * its job needs, and each is authorized on its own.
 */
export const MCP_SERVERS = ["experiments", "annotation"] as const;
export type McpServerName = (typeof MCP_SERVERS)[number];

/**
 * What a key may do. A scope named after an MCP server opens that server, and
 * `experiments` opens the agent API over the same operations; `transfer`
 * opens dataset transfer.
 */
export const API_SCOPES = [...MCP_SERVERS, "transfer"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
const apiScopeSchema = z.enum(API_SCOPES);

/** Every key starts with this so a leaked one is recognisable. */
export const API_KEY_PREFIX = "vf_";

const apiKeyNameSchema = z.string().trim().min(1).max(64);

/** A key as its owner sees it after creation: the secret is not recoverable. */
export const apiKeySchema = z.strictObject({
  id: z.string(),
  name: apiKeyNameSchema,
  /** The leading characters of the secret, for telling keys apart. */
  start: z.string(),
  scopes: z.array(apiScopeSchema),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
  lastUsedAt: timestampSchema.nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

/** A freshly issued key, the only time the secret is shown. */
export const issuedApiKeySchema = apiKeySchema.extend({ secret: z.string() });
export type IssuedApiKey = z.infer<typeof issuedApiKeySchema>;

export const MAX_API_KEY_DAYS = 365;

export const apiKeyCreateSchema = z.strictObject({
  name: apiKeyNameSchema,
  scopes: z.array(apiScopeSchema).min(1),
  /** Days until the key expires; null keeps it until it is revoked. */
  expiresInDays: z.number().int().min(1).max(MAX_API_KEY_DAYS).nullable(),
});
export type ApiKeyCreate = z.infer<typeof apiKeyCreateSchema>;

export const apiKeyRefSchema = z.strictObject({ key: z.string() });

/** The permission statement a key holds for each scope it was issued with. */
export function scopePermissions(
  scopes: readonly ApiScope[],
): Partial<Record<ApiScope, string[]>> {
  const permissions: Partial<Record<ApiScope, string[]>> = {};
  for (const scope of scopes) permissions[scope] = ["access"];
  return permissions;
}

/** The scopes a stored permission statement grants. */
export function permissionScopes(permissions: unknown): ApiScope[] {
  if (!permissions || typeof permissions !== "object") return [];
  return API_SCOPES.filter((scope) => {
    const actions = (permissions as Record<string, unknown>)[scope];
    return Array.isArray(actions) && actions.includes("access");
  });
}

/** An MCP client the account has authorized. */
export const mcpClientSchema = z.strictObject({
  /** The consent record; withdrawing it disconnects the client. */
  id: z.string(),
  clientId: z.string(),
  name: z.string(),
  /** The servers the client holds a grant for. */
  servers: z.array(z.enum(MCP_SERVERS)),
  grantedAt: timestampSchema,
  lastGrantedAt: timestampSchema,
});
export type McpClient = z.infer<typeof mcpClientSchema>;

export const mcpClientRefSchema = z.strictObject({ client: z.string() });
