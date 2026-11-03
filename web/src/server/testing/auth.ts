import type { McpServerName } from "../../domain/auth/integrations";
import {
  type UserAccount,
  type UserRole,
  userAccountSchema,
} from "../../domain/auth/schema";
import { issueApiKey } from "../auth/api-keys";
import { auth } from "../auth/service";
import { deploymentEndpoint } from "../infra/deployment";
import type { DpopKey } from "./dpop";

export const TEST_PASSWORD = "correct-horse-battery";

/** A fresh signed-in account with `role`; the headers carry its session cookie. */
export async function signInAs(
  role: UserRole,
): Promise<{ user: UserAccount; headers: Headers }> {
  const account = crypto.randomUUID();
  const email = `${role}-${account}@test.invalid`;
  const instance = await auth();
  const { user } = await instance.api.createUser({
    body: {
      email,
      password: TEST_PASSWORD,
      name: `${role} ${account}`,
      role,
    },
  });
  return {
    user: userAccountSchema.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned ?? false,
      createdAt: user.createdAt.toISOString(),
    }),
    headers: await sessionHeaders(email, TEST_PASSWORD),
  };
}

/** Signs in with the password and returns headers carrying the session cookie. */
export async function sessionHeaders(
  email: string,
  password: string,
): Promise<Headers> {
  const response = await (
    await auth()
  ).api.signInEmail({ body: { email, password }, asResponse: true });
  if (!response.ok) {
    throw new Error(`Sign-in refused: ${response.status}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";", 1)[0]!)
    .join("; ");
  return new Headers({ cookie });
}

/** Headers presenting `secret` as an API key. */
export function apiKeyHeaders(secret: string): Headers {
  return new Headers({ authorization: `Bearer ${secret}` });
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

interface McpAuthorization {
  clientId: string;
  accessToken: string;
  refreshToken: string | undefined;
}

/**
 * Runs the authorization flow an MCP client runs against the loopback auth
 * server: registers a public client unless one is given, sends the signed-in
 * browser through authorize and consent, and exchanges the code with PKCE
 * for an access token bound to one MCP server.
 */
export async function authorizeMcpClient(
  session: Headers,
  {
    name = "Test MCP client",
    server = "experiments",
    clientId: registered,
    dpop,
  }: {
    name?: string;
    server?: McpServerName;
    clientId?: string;
    dpop?: DpopKey;
  } = {},
): Promise<McpAuthorization> {
  const base = `${process.env.BETTER_AUTH_URL}/api/auth`;
  const redirectUri = "http://127.0.0.1/callback";
  const clientId =
    registered ?? (await registerMcpClient(base, name, redirectUri));

  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const resource = deploymentEndpoint().mcpResources[server];
  const authorize = await fetch(
    `${base}/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state: "state-1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
      ...(dpop ? { dpop_jkt: dpop.jkt } : {}),
    })}`,
    { headers: session, redirect: "manual" },
  );
  const consentLocation = authorize.headers.get("location");
  if (!consentLocation?.includes("/consent?")) {
    throw new Error(
      `Authorize did not ask for consent: ${authorize.status} ${consentLocation ?? (await authorize.text())}`,
    );
  }
  const consent = await fetch(`${base}/oauth2/consent`, {
    method: "POST",
    headers: {
      ...Object.fromEntries(session),
      "content-type": "application/json",
      accept: "application/json",
      origin: process.env.BETTER_AUTH_URL!,
    },
    body: JSON.stringify({
      accept: true,
      oauth_query: new URL(consentLocation, base).search.slice(1),
    }),
  });
  if (!consent.ok) {
    throw new Error(
      `Consent refused: ${consent.status} ${await consent.text()}`,
    );
  }
  const { url } = (await consent.json()) as { url: string };
  const code = new URL(url).searchParams.get("code");
  if (!code) throw new Error(`No authorization code in ${url}`);

  const token = await fetch(`${base}/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(dpop ? { dpop: await dpop.proof(`${base}/oauth2/token`) } : {}),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    }),
  });
  if (!token.ok) {
    throw new Error(
      `Token exchange refused: ${token.status} ${await token.text()}`,
    );
  }
  const { access_token: accessToken, refresh_token: refreshToken } =
    (await token.json()) as { access_token: string; refresh_token?: string };
  return { clientId, accessToken, refreshToken };
}

async function registerMcpClient(
  base: string,
  name: string,
  redirectUri: string,
): Promise<string> {
  const registration = await fetch(`${base}/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [redirectUri],
      application_type: "native",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  if (!registration.ok) {
    throw new Error(
      `Client registration refused: ${registration.status} ${await registration.text()}`,
    );
  }
  return ((await registration.json()) as { client_id: string }).client_id;
}

export async function agentHeaders(): Promise<Headers> {
  const { user } = await signInAs("member");
  return apiKeyHeaders(
    (
      await issueApiKey(user.id, {
        name: "Agent test",
        scopes: ["experiments"],
        expiresInDays: null,
      })
    ).secret,
  );
}
