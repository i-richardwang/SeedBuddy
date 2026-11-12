import { apiKey } from "@better-auth/api-key";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, jwt } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";
import { count } from "drizzle-orm";

import {
  API_KEY_PREFIX,
  MAX_API_KEY_DAYS,
} from "../../domain/auth/integrations";
import { MIN_PASSWORD_LENGTH } from "../../domain/auth/schema";
import { database, type Executor } from "../infra/db/client";
import * as schema from "../infra/db/schema";
import { deploymentEndpoint } from "../infra/deployment";

/**
 * Accounts, browser sessions, and programmatic access are Better Auth over
 * the application database: email and password sign-in, administrator-managed
 * accounts with no self-service sign-up, personal API keys for the HTTP
 * surfaces, and an OAuth 2.1 authorization server for MCP clients. Every
 * request reads its session from the database, so suspending an account or
 * revoking its sessions takes effect at once. The instance opens with the
 * database on first use so every request path shares one configuration.
 */

/** Administrators maintain accounts and sessions; members hold no directory permission. */
const accessControl = createAccessControl(defaultStatements);
const ROLES = {
  admin: accessControl.newRole(adminAc.statements),
  member: accessControl.newRole({}),
};

function build(db: Executor) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }
  const deployment = deploymentEndpoint();
  return betterAuth({
    appName: "SeedBuddy",
    baseURL: deployment.origin,
    secret,
    database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    plugins: [
      admin({
        ac: accessControl,
        roles: ROLES,
        defaultRole: "member",
        adminRoles: ["admin"],
      }),
      apiKey({
        defaultPrefix: API_KEY_PREFIX,
        requireName: true,
        rateLimit: { enabled: false },
        keyExpiration: {
          defaultExpiresIn: null,
          minExpiresIn: 1,
          maxExpiresIn: MAX_API_KEY_DAYS,
        },
        schema: { apikey: { modelName: "apiKey" } },
      }),
      jwt({ schema: { jwks: { modelName: "jwk" } } }),
      mcp({
        loginPage: "/login",
        consentPage: "/consent",
        // Tokens for the experiment and annotation servers carry different
        // audiences, so a grant for one does not open the other.
        resource: deployment.mcpResources.experiments,
        resources: [deployment.mcpResources.annotation],
        clientRegistrationDefaultResources: [
          deployment.mcpResources.annotation,
        ],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    ],
  });
}

type Auth = ReturnType<typeof build>;

/**
 * A deployment whose directory is empty admits nobody, so the first
 * administrator comes from the environment. Once any account exists the
 * variables are inert and administrators maintain the directory themselves.
 */
async function installFirstAdmin(instance: Auth, db: Executor): Promise<void> {
  const [{ total }] = await db.select({ total: count() }).from(schema.users);
  if (total !== 0) return;
  const email = process.env.SEEDBUDDY_ADMIN_EMAIL;
  const password = process.env.SEEDBUDDY_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn(
      "No accounts exist and SEEDBUDDY_ADMIN_EMAIL / SEEDBUDDY_ADMIN_PASSWORD are unset: nobody can sign in",
    );
    return;
  }
  await instance.api.createUser({
    body: { email, password, name: "Administrator", role: "admin" },
  });
}

let ready: Promise<Auth> | undefined;

async function open(): Promise<Auth> {
  const db = await database();
  const instance = build(db);
  await installFirstAdmin(instance, db);
  return instance;
}

/** The configured Better Auth instance over the application database. */
export function auth(): Promise<Auth> {
  ready ??= open().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  return ready;
}
