import { expect, test } from "bun:test";

import { createModel } from "../../models/public";
import { serveDatasetImport } from "./dataset-transfer";

function request(model: string, classes: string[]) {
  const body = JSON.stringify({
    schemaVersion: 1,
    dataset: "Transfer-refusal",
    model: { id: model, classes, area: "image" },
    images: [],
  });
  return new Request("http://localhost/transfer", {
    method: "PUT",
    headers: {
      "content-length": String(new TextEncoder().encode(body).byteLength),
    },
    body,
  });
}

test("transfer retains string refusals and 409 for invalid imports, with 404 for an unknown model", async () => {
  const model = await createModel({
    id: "transfer-refusal-model",
    name: "Transfer refusal model",
    classes: ["seed"],
  });
  const conflict = await serveDatasetImport(
    "Transfer-refusal",
    request(model.id, ["other"]),
  );
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({
    error: expect.stringContaining("has classes"),
  });
  const missing = await serveDatasetImport(
    "Transfer-refusal",
    request("unknown-transfer-model", ["seed"]),
  );
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({
    error: "Unknown model: unknown-transfer-model",
  });
});
