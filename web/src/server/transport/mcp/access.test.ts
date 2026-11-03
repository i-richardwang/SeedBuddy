import { describe, expect, test } from "bun:test";

import { guardMcpRequest, serveAuthorized } from "./access";
import { serveAnnotationMcp } from "./annotation";
import { serveExperimentsMcp } from "./experiments";
import { authorizeMcpClient, signInAs } from "../../testing/auth";
import { createDpopKey } from "../../testing/dpop";
import { modernRequest, requestEras } from "../../testing/mcp";
import { issueApiKey, revokeApiKey } from "../../auth/api-keys";
import { disconnectMcpClient, listMcpClients } from "../../auth/mcp-clients";
import { banUser } from "../../auth/users";

describe("MCP request guard", () => {
  const request = (hostname: string, origin?: string): Request =>
    new Request(`http://${hostname}/api/experiments/mcp`, {
      method: "POST",
      headers: {
        Host: hostname,
        ...(origin === undefined ? {} : { Origin: origin }),
      },
    });

  test("localhost requests pass without an Origin header", () => {
    expect(guardMcpRequest(request("localhost"))).toBeNull();
  });

  test("localhost browser requests pass", () => {
    expect(
      guardMcpRequest(request("localhost", "http://localhost:3000")),
    ).toBeNull();
  });

  test("a missing or foreign Host is rejected", () => {
    const missing = new Request("http://localhost/api/experiments/mcp", {
      method: "POST",
    });
    expect(guardMcpRequest(missing)?.status).toBe(403);
    expect(guardMcpRequest(request("workbench"))?.status).toBe(403);
  });

  test("a production deployment's Host and Origin pass", () => {
    const configured = process.env.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_URL = "https://lab.example";
    try {
      expect(guardMcpRequest(request("lab.example"))).toBeNull();
      expect(
        guardMcpRequest(request("lab.example", "https://lab.example")),
      ).toBeNull();
    } finally {
      process.env.BETTER_AUTH_URL = configured;
    }
  });

  test("a foreign browser Origin is rejected", () => {
    expect(
      guardMcpRequest(request("localhost", "https://evil.example"))?.status,
    ).toBe(403);
  });
});

describe("MCP OAuth request lifecycle", () => {
  for (const server of ["experiments", "annotation"] as const) {
    test.each(requestEras)(
      `${server} accepts bound DPoP tokens and rejects invalid or replayed proofs (%s)`,
      async (_, makeRequest) => {
        const { user, headers } = await signInAs("member");
        const key = await createDpopKey();
        const otherKey = await createDpopKey();
        const { accessToken } = await authorizeMcpClient(headers, {
          server,
          dpop: key,
        });
        const endpoint = `${process.env.BETTER_AUTH_URL}/api/${server}/mcp`;
        const serve =
          server === "experiments" ? serveExperimentsMcp : serveAnnotationMcp;
        const call = async (proof?: string) => {
          const request = makeRequest(endpoint, "tools/list");
          request.headers.set("authorization", `DPoP ${accessToken}`);
          if (proof) request.headers.set("dpop", proof);
          return serve(request);
        };

        expect((await call()).status).toBe(401);
        expect(
          (await call(await otherKey.proof(endpoint, accessToken))).status,
        ).toBe(401);
        expect(
          (await call(await key.proof(endpoint, "different-token"))).status,
        ).toBe(401);
        expect(
          (await call(await key.proof(`${endpoint}/other`, accessToken)))
            .status,
        ).toBe(401);
        expect(
          (
            await serve(
              makeRequest(endpoint, "tools/list", undefined, accessToken),
            )
          ).status,
        ).toBe(401);

        const proof = await key.proof(endpoint, accessToken);
        expect((await call(proof)).status).toBe(200);
        expect((await call(proof)).status).toBe(401);

        const otherEndpoint = `${process.env.BETTER_AUTH_URL}/api/${server === "experiments" ? "annotation" : "experiments"}/mcp`;
        const otherRequest = makeRequest(otherEndpoint, "tools/list");
        otherRequest.headers.set("authorization", `DPoP ${accessToken}`);
        otherRequest.headers.set(
          "dpop",
          await key.proof(otherEndpoint, accessToken),
        );
        const otherServe =
          server === "experiments" ? serveAnnotationMcp : serveExperimentsMcp;
        expect((await otherServe(otherRequest)).status).toBe(401);

        const [client] = await listMcpClients(user.id);
        await disconnectMcpClient(user.id, client!.id);
        expect(
          (await call(await key.proof(endpoint, accessToken))).status,
        ).toBe(401);
      },
    );
  }

  test("each accepted request uses the handler supplied by its caller", async () => {
    const { headers } = await signInAs("member");
    const { accessToken } = await authorizeMcpClient(headers);
    const endpoint = `${process.env.BETTER_AUTH_URL}/api/experiments/mcp`;
    for (const label of ["first", "second"]) {
      const response = await serveAuthorized(
        "experiments",
        modernRequest(endpoint, "tools/list", undefined, accessToken),
        async () => Response.json({ label }),
      );
      expect(await response.json()).toEqual({ label });
    }
  });

  test("an initialization failure remains retryable after bootstrap", async () => {
    const accessPath = new URL("./access.ts", import.meta.url).pathname;
    const setupPath = new URL("../../../../test/setup.ts", import.meta.url)
      .pathname;
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `
      const { serveAuthorized } = await import(${JSON.stringify(accessPath)});
      const request = () => new Request(process.env.BETTER_AUTH_URL + "/api/experiments/mcp");
      const handle = async () => new Response("unexpected");
      try {
        await serveAuthorized("experiments", request(), handle);
        throw new Error("Expected initialization to fail");
      } catch (error) {
        if (!error.message.includes("Database is not configured")) throw error;
      }
      await import(${JSON.stringify(setupPath)});
      const response = await serveAuthorized("experiments", request(), handle);
      if (response.status !== 401) throw new Error("Expected an OAuth challenge after recovery");
      process.exit(0);
    `,
      ],
      {
        env: { ...process.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [status, output] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(output).not.toContain("Expected");
    expect(status).toBe(0);
  }, 15_000);
});

describe("MCP API keys", () => {
  for (const server of ["experiments", "annotation"] as const) {
    const other = server === "experiments" ? "annotation" : "experiments";
    const endpoint = () => `${process.env.BETTER_AUTH_URL}/api/${server}/mcp`;
    const serve =
      server === "experiments" ? serveExperimentsMcp : serveAnnotationMcp;

    test.each(requestEras)(
      `${server} opens to a key holding its scope until the key is revoked (%s)`,
      async (_, makeRequest) => {
        const { user } = await signInAs("member");
        const key = await issueApiKey(user.id, {
          name: "Agent",
          scopes: [server],
          expiresInDays: null,
        });
        const call = () =>
          serve(makeRequest(endpoint(), "tools/list", undefined, key.secret));

        expect((await call()).status).toBe(200);
        await revokeApiKey(user.id, key.id);
        expect((await call()).status).toBe(401);
      },
    );

    test(`${server} challenges a key issued for another surface`, async () => {
      const { user } = await signInAs("member");
      const key = await issueApiKey(user.id, {
        name: "Elsewhere",
        scopes: [other, "transfer"],
        expiresInDays: null,
      });
      const response = await serve(
        modernRequest(endpoint(), "tools/list", undefined, key.secret),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        `/.well-known/oauth-protected-resource/api/${server}/mcp`,
      );
    });

    test(`${server} refuses the key of a suspended account`, async () => {
      const admin = await signInAs("admin");
      const { user } = await signInAs("member");
      const key = await issueApiKey(user.id, {
        name: "Agent",
        scopes: [server],
        expiresInDays: null,
      });
      await banUser(admin.headers, { user: user.id });
      const response = await serve(
        modernRequest(endpoint(), "tools/list", undefined, key.secret),
      );
      expect(response.status).toBe(401);
    });

    test(`${server} admits only POST from a key`, async () => {
      const { user } = await signInAs("member");
      const key = await issueApiKey(user.id, {
        name: "Agent",
        scopes: [server],
        expiresInDays: null,
      });
      const response = await serve(
        new Request(endpoint(), {
          headers: {
            host: new URL(endpoint()).host,
            authorization: `Bearer ${key.secret}`,
          },
        }),
      );
      expect(response.status).toBe(405);
    });
  }
});
