import { expect, test } from "bun:test";

import { imageRefSchema } from "../../../domain/images/schema";
import { parseHttpJson } from "../../../lib/http/json";
import { issueApiKey } from "../../auth/api-keys";
import { apiKeyHeaders, signInAs } from "../../testing/auth";
import {
  handleCanonicalImageUpload,
  handleImageUpload,
  serveAgentImageUpload,
} from "./image-upload";

test("agent image uploads use structured errors while transfer uploads retain string errors", async () => {
  const { user } = await signInAs("member");
  const key = await issueApiKey(user.id, {
    name: "Image upload",
    scopes: ["experiments"],
    expiresInDays: null,
  });
  const headers = apiKeyHeaders(key.secret);
  headers.set("content-length", "3");
  const request = () =>
    new Request("http://localhost/upload", {
      method: "POST",
      headers,
      body: "bad",
    });
  const agent = await serveAgentImageUpload(request());
  expect(agent.status).toBe(400);
  expect(await agent.json()).toEqual({
    error: {
      code: "invalid_request",
      message: "The file must contain a JPEG, PNG, or TIFF image",
    },
  });
  const transfer = await handleCanonicalImageUpload("a".repeat(64), request());
  expect(transfer.status).toBe(400);
  expect(await transfer.json()).toEqual({
    error: `The bytes do not hash to ${"a".repeat(64)}`,
  });
});

test("browser upload displays the actual refusal through its JSON parser", async () => {
  const response = await handleImageUpload(
    new Request("http://localhost/api/images", {
      method: "POST",
      headers: { "content-length": "3" },
      body: "bad",
    }),
  );
  const text = await response.text();
  expect(response.status).toBe(400);
  expect(JSON.parse(text)).toEqual({
    error: "The file must contain a JPEG, PNG, or TIFF image",
  });
  expect(() => parseHttpJson(text, response.status, imageRefSchema)).toThrow(
    "The file must contain a JPEG, PNG, or TIFF image",
  );
});
