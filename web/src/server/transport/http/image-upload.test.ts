import { expect, test } from "bun:test";

import { issueApiKey } from "../../auth/api-keys";
import { apiKeyHeaders, signInAs } from "../../testing/auth";
import { handleCanonicalImageUpload, handleImageUpload } from "./image-upload";

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
  const agent = await handleImageUpload(request());
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
