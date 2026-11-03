import { describe, expect, test } from "bun:test";

import { disconnectMcpClient, listMcpClients } from "../../auth/mcp-clients";
import { createModel } from "../../models/public";
import { authorizeMcpClient, signInAs } from "../../testing/auth";
import { observeImagesForModel } from "../../testing/fixtures";
import { legacyRequest, modernRequest, rpcMessage } from "../../testing/mcp";
import { annotationResourceMetadata } from "./access";
import { serveAnnotationMcp } from "./annotation";
import { serveExperimentsMcp } from "./experiments";

const annotationEndpoint = () =>
  `${process.env.BETTER_AUTH_URL}/api/annotation/mcp`;
const experimentsEndpoint = () =>
  `${process.env.BETTER_AUTH_URL}/api/experiments/mcp`;

async function toolNames(response: Response): Promise<string[]> {
  expect(response.status).toBe(200);
  return (await rpcMessage(response)).result.tools
    .map((tool: { name: string }) => tool.name)
    .sort();
}

const ANNOTATION_TOOLS = [
  "annotation_cancel",
  "annotation_context",
  "annotation_find",
  "annotation_next",
  "annotation_pending",
  "annotation_preview",
  "annotation_read",
  "annotation_start",
  "annotation_submit",
  "annotation_view",
];

describe("annotation MCP authorization", () => {
  const annotation = (
    token: string,
    method: string,
    params?: Record<string, unknown>,
  ) =>
    serveAnnotationMcp(
      modernRequest(annotationEndpoint(), method, params, token),
    );
  const experiments = (token: string) =>
    serveExperimentsMcp(
      modernRequest(experimentsEndpoint(), "tools/list", undefined, token),
    );
  test("tool hints warn that cancellation discards progress, submission is idempotent and reads change nothing", async () => {
    const { headers } = await signInAs("member");
    const { accessToken } = await authorizeMcpClient(headers, {
      server: "annotation",
    });
    const response = await annotation(accessToken, "tools/list");
    expect(response.status).toBe(200);
    const { tools } = (await rpcMessage(response)).result;
    const tool = (name: string) =>
      tools.find((item: { name: string }) => item.name === name);
    expect(tool("annotation_cancel").annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(tool("annotation_submit").annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(tool("annotation_pending").annotations.readOnlyHint).toBe(true);
    expect(tool("annotation_read").annotations.readOnlyHint).toBe(true);
    expect(tool("annotation_next").annotations.readOnlyHint).toBe(true);
    expect(tool("annotation_context").annotations.readOnlyHint).toBe(true);
    expect(tool("annotation_view").annotations.readOnlyHint).toBe(true);
    const invalid = await annotation(accessToken, "tools/call", {
      name: "annotation_submit",
      arguments: {},
    });
    const invalidResult = (await rpcMessage(invalid)).result;
    expect(invalidResult.isError).toBe(true);
    expect(invalidResult.content[0].text).toContain("Input validation error");
    const missing = await annotation(accessToken, "tools/call", {
      name: "annotation_view",
      arguments: { taskId: "missing-task" },
    });
    const missingResult = (await rpcMessage(missing)).result;
    expect(missingResult.isError).toBe(true);
    expect(JSON.parse(missingResult.content[0].text)).toMatchObject({
      code: "not_found",
      message: expect.any(String),
    });
  });

  test("a request without a token is challenged toward the annotation resource metadata", async () => {
    const response = await serveAnnotationMcp(
      modernRequest(annotationEndpoint(), "tools/list"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `${process.env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource/api/annotation/mcp`,
    );
  });

  test("the resource metadata differs from the experiment server's only in its resource", async () => {
    const path = "/.well-known/oauth-protected-resource";
    const own = await annotationResourceMetadata(
      new Request(`${process.env.BETTER_AUTH_URL}${path}/api/annotation/mcp`),
    );
    expect(own?.status).toBe(200);
    const shared = await fetch(
      `${process.env.BETTER_AUTH_URL}${path}/api/experiments/mcp`,
    );
    expect(await own!.json()).toEqual({
      ...(await shared.json()),
      resource: annotationEndpoint(),
    });
    expect(
      await annotationResourceMetadata(
        new Request(
          `${process.env.BETTER_AUTH_URL}${path}/api/experiments/mcp`,
        ),
      ),
    ).toBeNull();
  });

  test("each server opens only to grants for it, and one client can hold both", async () => {
    const { user, headers } = await signInAs("member");
    const forExperiments = await authorizeMcpClient(headers);
    expect(
      (await annotation(forExperiments.accessToken, "tools/list")).status,
    ).toBe(401);

    const forAnnotation = await authorizeMcpClient(headers, {
      server: "annotation",
    });
    expect(
      await toolNames(
        await annotation(forAnnotation.accessToken, "tools/list"),
      ),
    ).toEqual(ANNOTATION_TOOLS);
    expect((await experiments(forAnnotation.accessToken)).status).toBe(401);
    const experimentTools = await toolNames(
      await experiments(forExperiments.accessToken),
    );
    expect(experimentTools).toContain("list-experiments");
    expect(experimentTools.some((name) => name.startsWith("annotation_"))).toBe(
      false,
    );

    const both = await authorizeMcpClient(headers, {
      server: "annotation",
      clientId: forExperiments.clientId,
    });
    expect((await annotation(both.accessToken, "tools/list")).status).toBe(200);
    expect((await experiments(forExperiments.accessToken)).status).toBe(200);
    const clients = await listMcpClients(user.id);
    expect(
      clients.find((client) => client.clientId === forExperiments.clientId)
        ?.servers,
    ).toEqual(["experiments", "annotation"]);

    for (const client of clients) await disconnectMcpClient(user.id, client.id);
    expect((await annotation(both.accessToken, "tools/list")).status).toBe(401);
    expect((await experiments(forExperiments.accessToken)).status).toBe(401);
  });

  test("a grant for one server cannot be refreshed into a token for the other", async () => {
    const { headers } = await signInAs("member");
    const { clientId, refreshToken } = await authorizeMcpClient(headers);
    expect(refreshToken).toBeDefined();
    const refreshed = await fetch(
      `${process.env.BETTER_AUTH_URL}/api/auth/oauth2/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken!,
          client_id: clientId,
          resource: annotationEndpoint(),
        }),
      },
    );
    expect(refreshed.ok).toBe(false);
    expect(((await refreshed.json()) as { error: string }).error).toBe(
      "invalid_target",
    );
  });

  test("an agent finds the images waiting for it and annotates them region by region", async () => {
    const { headers } = await signInAs("member");
    const { accessToken } = await authorizeMcpClient(headers, {
      server: "annotation",
    });
    const model = await createModel({
      id: "mcp-annotation",
      name: "Annotation over MCP",
      classes: ["ungerminated", "germinated"],
      annotation: {
        area: "image",
        instructions: "Box every seed.",
        coreSize: 512,
        halo: 32,
        displayScale: 1,
      },
    });
    const observed = await observeImagesForModel(
      "mcp-annotation",
      ["mcp-annotation"],
      model.id,
    );
    const ref = { digest: observed.digests[0]!, modelId: model.id };
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await annotation(accessToken, "tools/call", {
        name,
        arguments: args,
      });
      expect(response.status).toBe(200);
      return (await rpcMessage(response)).result;
    };
    const pending = async () =>
      JSON.parse(
        (await call("annotation_pending", { modelId: model.id })).content[0]
          .text,
      );
    expect(await pending()).toMatchObject({
      total: 1,
      images: [{ ref, progress: null }],
    });
    const refused = await call("annotation_start", {
      ref,
      input: [
        {
          id: "weed",
          class: "weed",
          bbox: { x: 0, y: 0, width: 1, height: 1 },
        },
      ],
    });
    expect(refused).toMatchObject({
      isError: true,
      content: [
        {
          text: JSON.stringify({
            code: "invalid_request",
            message: "AI annotation input uses unknown class: weed",
          }),
        },
      ],
    });
    const started = await call("annotation_start", { ref });
    expect(started.isError).toBeUndefined();
    expect((await pending()).images[0].progress).toEqual({
      completed: 0,
      total: 1,
    });
    const next = await call("annotation_next", { ref });
    const { taskId } = JSON.parse(next.content[0].text);
    const context = await call("annotation_context", { taskId });
    expect(
      context.content.filter((item: { type: string }) => item.type === "image"),
    ).toHaveLength(1);
    const viewed = await call("annotation_view", { taskId });
    expect(JSON.parse(viewed.content[0].text).contextId).toBe(
      JSON.parse(context.content[0].text).contextId,
    );
    expect(
      viewed.content.filter((item: { type: string }) => item.type === "image"),
    ).toHaveLength(1);
    const preview = await call("annotation_preview", {
      taskId,
      instances: [],
    });
    expect(preview.isError).toBeUndefined();
    const { proposalId } = JSON.parse(preview.content[0].text);
    const submit = await call("annotation_submit", { taskId, proposalId });
    expect(JSON.parse(submit.content[0].text).status).toBe("succeeded");
    expect(await pending()).toEqual({ total: 0, images: [] });
    const read = JSON.parse(
      (await call("annotation_read", { ref })).content[0].text,
    );
    expect(read.reading).toBe("proposal");
    expect(read.review).toBeNull();
    const partial = {
      ref,
      input: "proposal",
      scope: [{ x: 0, y: 0, width: 8, height: 8 }],
    };
    const redraw = await call("annotation_start", partial);
    expect(redraw.isError).toBeUndefined();
    expect(JSON.parse(redraw.content[0].text).progress.total).toBe(1);
    expect((await call("annotation_start", partial)).isError).toBe(true);
    expect((await call("annotation_cancel", { ref })).isError).toBeUndefined();
    expect((await call("annotation_next", { ref })).isError).toBe(true);

    for (const method of ["GET", "DELETE"]) {
      const response = await serveAnnotationMcp(
        new Request(annotationEndpoint(), {
          method,
          headers: {
            host: new URL(annotationEndpoint()).host,
            authorization: `Bearer ${accessToken}`,
          },
        }),
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });
});

test("legacy annotation initialization negotiates tools without creating a session", async () => {
  const { headers } = await signInAs("member");
  const { accessToken } = await authorizeMcpClient(headers, {
    server: "annotation",
  });
  const response = await serveAnnotationMcp(
    legacyRequest(
      annotationEndpoint(),
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "annotation-compatibility-test", version: "1" },
      },
      accessToken,
    ),
  );
  expect(response.status).toBe(200);
  expect(response.headers.has("mcp-session-id")).toBe(false);
  expect((await rpcMessage(response)).result).toMatchObject({
    protocolVersion: "2025-06-18",
    capabilities: { tools: {} },
  });
  const notified = await serveAnnotationMcp(
    legacyRequest(
      annotationEndpoint(),
      "notifications/initialized",
      undefined,
      accessToken,
    ),
  );
  expect(notified.status).toBe(202);
  expect(
    await toolNames(
      await serveAnnotationMcp(
        legacyRequest(
          annotationEndpoint(),
          "tools/list",
          undefined,
          accessToken,
        ),
      ),
    ),
  ).toEqual(ANNOTATION_TOOLS);
});
