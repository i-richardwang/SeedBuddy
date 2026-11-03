import { and, desc, eq } from "drizzle-orm";

import { ApiKeyNotFoundError } from "../../domain/auth/errors";
import {
  type ApiKey,
  type ApiKeyCreate,
  type ApiScope,
  apiKeySchema,
  type IssuedApiKey,
  issuedApiKeySchema,
  permissionScopes,
  scopePermissions,
} from "../../domain/auth/integrations";
import { database } from "../infra/db/client";
import { apiKeys, users } from "../infra/db/schema";
import { bearerToken } from "./bearer";
import { auth } from "./service";

/**
 * Personal API keys. Issuing goes through Better Auth so the secret is hashed
 * the way its verifier expects; listing and revoking address the owner's rows
 * directly. A key opens a surface only while its owner is in good standing.
 */

const DAY_SECONDS = 24 * 60 * 60;

function parsePermissions(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function toApiKey(row: {
  id: string;
  name: string | null;
  start: string | null;
  permissions: unknown;
  createdAt: Date;
  expiresAt: Date | null;
  lastRequest: Date | null;
}): ApiKey {
  return apiKeySchema.parse({
    id: row.id,
    name: row.name,
    start: row.start ?? "",
    scopes: permissionScopes(parsePermissions(row.permissions)),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastRequest?.toISOString() ?? null,
  });
}

/** The keys `user` holds, newest first. */
export async function listApiKeys(user: string): Promise<ApiKey[]> {
  const rows = await (
    await database()
  )
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.referenceId, user))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map(toApiKey);
}

/** Issues a key to `user`; the returned secret is not recoverable afterwards. */
export async function issueApiKey(
  user: string,
  input: ApiKeyCreate,
): Promise<IssuedApiKey> {
  const created = await (
    await auth()
  ).api.createApiKey({
    body: {
      userId: user,
      name: input.name,
      permissions: scopePermissions(input.scopes),
      ...(input.expiresInDays === null
        ? {}
        : { expiresIn: input.expiresInDays * DAY_SECONDS }),
    },
  });
  return issuedApiKeySchema.parse({
    ...toApiKey(created),
    secret: created.key,
  });
}

/** Deletes one of `user`'s keys; requests presenting it are refused at once. */
export async function revokeApiKey(user: string, id: string): Promise<void> {
  const deleted = await (
    await database()
  )
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.referenceId, user)))
    .returning({ id: apiKeys.id });
  if (deleted.length === 0) {
    throw new ApiKeyNotFoundError(`Unknown API key: ${id}`);
  }
}

/**
 * Whether a request's bearer API key admits it to `scope`. A request carrying
 * no key, an unknown, expired, or out-of-scope one, or a key whose owner has
 * been suspended or removed is not admitted.
 */
export async function authorizeApiKey(
  request: Request,
  scope: ApiScope,
): Promise<boolean> {
  const secret = bearerToken(request);
  if (!secret) return false;
  const verdict = await (
    await auth()
  ).api.verifyApiKey({
    body: { key: secret, permissions: scopePermissions([scope]) },
  });
  if (!verdict.valid || !verdict.key) return false;
  const [owner] = await (
    await database()
  )
    .select({ banned: users.banned })
    .from(users)
    .where(eq(users.id, verdict.key.referenceId));
  return owner !== undefined && !owner.banned;
}
