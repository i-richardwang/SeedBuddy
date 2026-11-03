import { describe, expect, test } from "bun:test";
import { McpClientNotFoundError } from "../../../domain/auth/errors";
import { experimentsMcpHandler, serveExperimentsMcp } from "./experiments";
import { agentOperations } from "../../agent/operations";
import { disconnectMcpClient, listMcpClients } from "../../auth/mcp-clients";
import { authorizeMcpClient, signInAs } from "../../testing/auth";
import { banUser, revokeUserSessions } from "../../auth/users";
import {
  legacyRequest,
  modernRequest,
  requestEras,
  rpcMessage,
} from "../../testing/mcp";

async function rpc(method: string, params?: unknown): Promise<unknown> {
  const response = await experimentsMcpHandler.fetch(
    modernRequest(
      "http://workbench/api/experiments/mcp",
      method,
      params as Record<string, unknown> | undefined,
    ),
  );
  expect(response.status).toBe(200);
  return (await rpcMessage(response)).result;
}

describe("experiment MCP surface", () => {
  test("lists every registry operation as a fully described tool", async () => {
    const { tools } = (await rpc("tools/list")) as {
      tools: {
        name: string;
        description?: string;
        inputSchema?: unknown;
        outputSchema?: unknown;
        annotations?: Record<string, unknown>;
      }[];
    };
    expect(tools.map(({ name }) => name).sort()).toEqual(
      [...agentOperations.keys()].sort(),
    );
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toMatchObject({ openWorldHint: false });
    }
  });

  test("a tool call returns structured content", async () => {
    const result = (await rpc("tools/call", {
      name: "list-experiments",
      arguments: {},
    })) as { structuredContent?: unknown; isError?: boolean };
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
  });

  test("an operation with no result answers null structured content", async () => {
    const created = (await rpc("tools/call", {
      name: "create-experiment",
      arguments: {
        name: `Transient ${crypto.randomUUID()}`,
        inoculatedOn: "2026-09-02",
        treatments: [{ name: "T1", replicates: 1 }],
      },
    })) as { structuredContent: { id: string } };
    const deleted = (await rpc("tools/call", {
      name: "delete-experiment",
      arguments: { experiment: created.structuredContent.id },
    })) as { structuredContent: unknown; isError?: boolean };
    expect(deleted.isError).toBeFalsy();
    expect(deleted.structuredContent).toBeNull();
  });

  test("a domain failure reads as a tool error, not a protocol error", async () => {
    const result = (await rpc("tools/call", {
      name: "get-experiment",
      arguments: { experiment: crypto.randomUUID() },
    })) as { content: { type: string; text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      code: "not_found",
      message: expect.stringContaining("Unknown experiment"),
    });
  });

  test("a repeated create is refused by the record it would duplicate", async () => {
    const name = `MCP ${crypto.randomUUID()}`;
    const params = {
      name: "create-experiment",
      arguments: {
        name,
        inoculatedOn: "2026-09-02",
        treatments: [{ name: "T1", replicates: 1 }],
      },
    };
    const created = (await rpc("tools/call", params)) as {
      structuredContent: { name: string };
    };
    expect(created.structuredContent.name).toBe(name);
    const repeated = (await rpc("tools/call", params)) as { isError?: boolean };
    expect(repeated.isError).toBe(true);
  });
});

describe.each(requestEras)(
  "experiment MCP authorization (%s)",
  (_, request) => {
    const endpoint = () => `${process.env.BETTER_AUTH_URL}/api/experiments/mcp`;

    const call = (token?: string): Promise<Response> =>
      serveExperimentsMcp(request(endpoint(), "tools/list", undefined, token));

    test("a request without a token is challenged toward the resource metadata", async () => {
      const response = await call();
      expect(response.status).toBe(401);
      const challenge = response.headers.get("www-authenticate") ?? "";
      expect(challenge).toContain("Bearer");
      expect(challenge).toContain(
        `${process.env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource/api/experiments/mcp`,
      );
    });

    test("the resource metadata names this workbench as the authorization server", async () => {
      const response = await fetch(
        `${process.env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource/api/experiments/mcp`,
      );
      expect(response.status).toBe(200);
      const metadata = (await response.json()) as {
        resource: string;
        authorization_servers: string[];
      };
      expect(metadata.resource).toBe(endpoint());
      expect(metadata.authorization_servers).toEqual([
        `${process.env.BETTER_AUTH_URL}/api/auth`,
      ]);
    });

    test("a client the account authorized reaches the tools until it is disconnected", async () => {
      const { user, headers } = await signInAs("member");
      const { clientId, accessToken } = await authorizeMcpClient(headers, {
        name: "Claude on the bench",
      });

      const accepted = await call(accessToken);
      expect(accepted.status).toBe(200);
      expect(await accepted.text()).toContain("list-experiments");

      const [client] = await listMcpClients(user.id);
      expect(client).toMatchObject({
        clientId,
        name: "Claude on the bench",
        servers: ["experiments"],
      });

      const other = await signInAs("member");
      expect(await listMcpClients(other.user.id)).toEqual([]);
      await expect(
        disconnectMcpClient(other.user.id, client!.id),
      ).rejects.toBeInstanceOf(McpClientNotFoundError);

      await disconnectMcpClient(user.id, client!.id);
      expect(await listMcpClients(user.id)).toEqual([]);
      expect((await call(accessToken)).status).toBe(401);
    });

    test("suspending the account invalidates an issued access token", async () => {
      const admin = await signInAs("admin");
      const member = await signInAs("member");
      const { accessToken } = await authorizeMcpClient(member.headers);
      expect((await call(accessToken)).status).toBe(200);
      await banUser(admin.headers, { user: member.user.id });
      expect((await call(accessToken)).status).toBe(401);
    });

    test("revoking the account's sessions invalidates an issued access token", async () => {
      const admin = await signInAs("admin");
      const member = await signInAs("member");
      const { accessToken } = await authorizeMcpClient(member.headers);
      expect((await call(accessToken)).status).toBe(200);
      await revokeUserSessions(admin.headers, { user: member.user.id });
      expect((await call(accessToken)).status).toBe(401);
    });

    test("a forged token is refused", async () => {
      const response = await call("not-a-token");
      expect(response.status).toBe(401);
    });
  },
);

test("legacy initialization negotiates tools without creating a session", async () => {
  const endpoint = () => `${process.env.BETTER_AUTH_URL}/api/experiments/mcp`;
  const { headers } = await signInAs("member");
  const { accessToken } = await authorizeMcpClient(headers);
  const initialized = await serveExperimentsMcp(
    legacyRequest(
      endpoint(),
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "compatibility-test", version: "1" },
      },
      accessToken,
    ),
  );
  expect(initialized.status).toBe(200);
  expect(initialized.headers.has("mcp-session-id")).toBe(false);
  expect((await rpcMessage(initialized)).result).toMatchObject({
    protocolVersion: "2025-06-18",
    capabilities: { tools: {} },
  });
  const notified = await serveExperimentsMcp(
    legacyRequest(
      endpoint(),
      "notifications/initialized",
      undefined,
      accessToken,
    ),
  );
  expect(notified.status).toBe(202);
  const listed = await serveExperimentsMcp(
    legacyRequest(endpoint(), "tools/list", undefined, accessToken),
  );
  expect(listed.status).toBe(200);
  expect(
    (await rpcMessage(listed)).result.tools
      .map((tool: { name: string }) => tool.name)
      .sort(),
  ).toEqual([...agentOperations.keys()].sort());
  const called = await serveExperimentsMcp(
    legacyRequest(
      endpoint(),
      "tools/call",
      { name: "list-experiments", arguments: {} },
      accessToken,
    ),
  );
  expect(called.status).toBe(200);
  const result = (await rpcMessage(called)).result;
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toBeDefined();
  const unauthenticated = await serveExperimentsMcp(
    legacyRequest(endpoint(), "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "unauthorized", version: "1" },
    }),
  );
  expect(unauthenticated.status).toBe(401);
});
