import { expect, test } from "bun:test";

import { contentDigest } from "../../infra/digest";
import {
  workerPackageDescription,
  workerPackageResponse,
} from "./worker-package";

const content = new TextEncoder().encode("wheel bytes");
const shipped = {
  filename: "seedctl-0.1.0-py3-none-any.whl",
  digest: contentDigest(content),
  content: new Uint8Array(content),
};
const url = `http://localhost/worker-package/${shipped.filename}`;

test("the shipped worker package is served under its wheel name and revalidated by digest", async () => {
  const served = workerPackageResponse(
    shipped,
    shipped.filename,
    new Request(url),
  );
  expect(served.status).toBe(200);
  expect(served.headers.get("Content-Length")).toBe(String(content.byteLength));
  expect(served.headers.get("Cache-Control")).toBe("no-cache");
  expect(new Uint8Array(await served.arrayBuffer())).toEqual(shipped.content);

  const tag = served.headers.get("ETag")!;
  expect(tag).toBe(`"${shipped.digest}"`);
  const revalidated = workerPackageResponse(
    shipped,
    shipped.filename,
    new Request(url, { headers: { "If-None-Match": tag } }),
  );
  expect(revalidated.status).toBe(304);
  expect(await revalidated.text()).toBe("");
});

test("any other name, and a workbench that ships no package, answer 404", () => {
  const request = new Request(url);
  expect(
    workerPackageResponse(shipped, "seedctl-0.2.0-py3-none-any.whl", request)
      .status,
  ).toBe(404);
  expect(workerPackageResponse(null, shipped.filename, request).status).toBe(
    404,
  );
});

test("the description names the shipped package and its digest", async () => {
  const described = workerPackageDescription(shipped);
  expect(described.headers.get("Cache-Control")).toBe("no-cache");
  expect(await described.json()).toEqual({
    filename: shipped.filename,
    digest: shipped.digest,
  });
  expect(workerPackageDescription(null).status).toBe(404);
});
