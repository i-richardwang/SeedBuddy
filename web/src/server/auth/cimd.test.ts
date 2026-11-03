import { expect, test } from "bun:test";

test("a CIMD public client completes OAuth through the pinned HTTPS transport", async () => {
  // Isolate built-in network mocks from the auth server and other tests.
  const setup = new URL("../../../test/setup.ts", import.meta.url).pathname;
  const fixtures = new URL("../testing/auth.ts", import.meta.url).pathname;
  const annotation = new URL("../transport/mcp/annotation.ts", import.meta.url)
    .pathname;
  const requests = new URL("../testing/mcp.ts", import.meta.url).pathname;
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      import { EventEmitter } from "node:events";
      import { Readable } from "node:stream";
      // Load built-ins before replacing their exports in Bun's eval runtime.
      await import("node:dns/promises");
      await import("node:https");
      const clientId = "https://client.example/oauth/client.json";
      const address = { address: "93.184.216.34", family: 4 };
      let connections = 0;
      mock.module("node:dns/promises", () => ({
        lookup: async (hostname, options) => {
          assert.equal(options.all, true);
          assert.equal(options.verbatim, true);
          return hostname === "private.example"
            ? [address, { address: "127.0.0.1", family: 4 }]
            : [address, { address: "2606:4700::1111", family: 6 }];
        },
      }));
      mock.module("node:https", () => ({
        request: (url, options, respond) => {
          connections++;
          assert.equal(url.href, clientId);
          assert.equal(options.method, "GET");
          assert.equal(options.agent, false);
          assert.equal(options.headers.host, "client.example");
          assert.equal(options.servername, "client.example");
          // Automatic family selection asks for all addresses; older runtimes
          // use the scalar callback. Both must pin the one validated address.
          options.lookup(url.hostname, { all: true }, (error, addresses) => {
            assert.equal(error, null);
            assert.deepEqual(addresses, [address]);
          });
          options.lookup(url.hostname, { all: false }, (error, ip, family) => {
            assert.equal(error, null);
            assert.equal(ip, address.address);
            assert.equal(family, address.family);
          });
          const outgoing = new EventEmitter();
          outgoing.end = () => {
            const response = Readable.from([Buffer.from(JSON.stringify({
              client_id: clientId,
              client_name: "CIMD test client",
              application_type: "native",
              redirect_uris: ["http://127.0.0.1/callback"],
              token_endpoint_auth_method: "none",
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
            }))]);
            response.statusCode = 200;
            response.statusMessage = "OK";
            response.headers = { "content-type": "application/json" };
            respond(response);
          };
          return outgoing;
        },
      }));
      const { fetchClientMetadataResource } = await import("@better-auth/cimd/node");
      await assert.rejects(
        fetchClientMetadataResource("https://private.example/client.json"),
        /public-routable/,
      );
      assert.equal(connections, 0, "all DNS answers must pass before connecting");
      assert.equal((await fetchClientMetadataResource(clientId)).status, 200);
      connections = 0;
      await import(${JSON.stringify(setup)});
      const { signInAs, authorizeMcpClient } = await import(${JSON.stringify(fixtures)});
      const { serveAnnotationMcp } = await import(${JSON.stringify(annotation)});
      const { modernRequest } = await import(${JSON.stringify(requests)});
      const { headers } = await signInAs("member");
      const { accessToken } = await authorizeMcpClient(headers, {
        server: "annotation", clientId,
      });
      assert.ok(connections > 0, "CIMD must fetch through the configured transport");
      const response = await serveAnnotationMcp(modernRequest(
        process.env.BETTER_AUTH_URL + "/api/annotation/mcp",
        "tools/list", undefined, accessToken,
      ));
      assert.equal(response.status, 200, await response.text());
      process.exit(0);
      `,
    ],
    {
      env: { ...process.env, NODE_ENV: "test" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [status, output, errors] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ status, errors: status === 0 ? "" : output + errors }).toEqual({
    status: 0,
    errors: "",
  });
}, 15_000);
