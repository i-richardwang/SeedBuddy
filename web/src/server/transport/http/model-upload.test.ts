import { expect, test } from "bun:test";

import { YOLO26N_WHOLE_RECIPE } from "../../../domain/training/recipes";
import { issueApiKey } from "../../auth/api-keys";
import { createModel, readCurrentVersionId } from "../../models/public";
import { apiKeyHeaders, signInAs } from "../../testing/auth";
import { modernRequest, rpcMessage } from "../../testing/mcp";
import { trainingBundle } from "../../testing/model-bundle";
import { serveExperimentsMcp } from "../mcp/experiments";
import { serveAgentOperationCall } from "./agent";
import { serveModelWeightsUpload } from "./model-upload";

test("HTTP uploads and MCP registration share a candidate without creating training or activating it", async () => {
  const model = await createModel({
    id: "http-import-model",
    name: "HTTP import",
    classes: ["seed"],
  });
  const { user } = await signInAs("member");
  const key = await issueApiKey(user.id, {
    name: "Model delivery",
    scopes: ["experiments"],
    expiresInDays: null,
  });
  const headers = apiKeyHeaders(key.secret);
  const weights = new TextEncoder().encode("trained locally");
  const bundle = trainingBundle(
    weights,
    {
      training: YOLO26N_WHOLE_RECIPE,
      inference: {
        confidence: 0.3,
        imageSize: 1536,
        maxDetections: 500,
        endToEnd: false,
      },
      validation: {
        precision: 0.5,
        recall: 0.4,
        map50: 0.5,
        map50To95: 0.3,
        fitness: 0.3,
      },
    },
    ["seed"],
    "external-snapshot",
  );
  bundle.provenance.dataset.snapshotId = null;
  const prepared = await serveAgentOperationCall(
    "prepare-model-upload",
    new Request("http://workbench/api/agent/prepare-model-upload", {
      method: "POST",
      headers,
      body: JSON.stringify({ model: model.id, bundle }),
    }),
  );
  expect(prepared.status).toBe(200);
  const {
    result: { uploadId },
  } = await prepared.json();
  const unauthenticated = await serveModelWeightsUpload(
    uploadId,
    new Request("http://workbench/upload", { method: "PUT", body: weights }),
  );
  expect(unauthenticated.status).toBe(401);
  const uploaded = await serveModelWeightsUpload(
    uploadId,
    new Request("http://workbench/upload", {
      method: "PUT",
      headers: new Headers([
        ...headers,
        ["content-length", String(weights.byteLength)],
      ]),
      body: weights,
    }),
  );
  expect(uploaded.status).toBe(200);
  const response = await serveExperimentsMcp(
    modernRequest(
      `${process.env.BETTER_AUTH_URL}/api/experiments/mcp`,
      "tools/call",
      {
        name: "register-model-upload",
        arguments: { uploadId },
      },
      key.secret,
    ),
  );
  const message = await rpcMessage(response);
  const result = message.result as {
    isError?: boolean;
    structuredContent: { id: string; source: { kind: string } };
  };
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent.source.kind).toBe("import");
  expect(await readCurrentVersionId(model.id)).toBeNull();
  const selected = await serveAgentOperationCall(
    "use-model-version",
    new Request("http://workbench/api/agent/use-model-version", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model.id,
        version: result.structuredContent.id,
      }),
    }),
  );
  expect(selected.status).toBe(200);
  expect(await readCurrentVersionId(model.id)).toBe(
    result.structuredContent.id,
  );
});

test("model upload admission and missing uploads use the agent error document", async () => {
  const { user } = await signInAs("member");
  const key = await issueApiKey(user.id, {
    name: "Upload failures",
    scopes: ["experiments"],
    expiresInDays: null,
  });
  const headers = apiKeyHeaders(key.secret);
  const admission = await serveModelWeightsUpload(
    crypto.randomUUID(),
    new Request("http://localhost/upload", { method: "PUT", headers }),
  );
  expect(admission.status).toBe(411);
  expect(await admission.json()).toEqual({
    error: { code: "invalid_request", message: "Content-Length is required" },
  });
  headers.set("content-length", "3");
  const missing = await serveModelWeightsUpload(
    crypto.randomUUID(),
    new Request("http://localhost/upload", {
      method: "PUT",
      headers,
      body: "abc",
    }),
  );
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({
    error: { code: "not_found", message: expect.any(String) },
  });
});
