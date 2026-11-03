import { expect, test } from "bun:test";
import { exactLengthBody } from "./upload-body";
import { handleImageUpload } from "./image-upload";

function request(body?: string, length?: string): Request {
  return new Request("http://workbench/upload", {
    method: "PUT",
    headers: length === undefined ? {} : { "content-length": length },
    ...(body === undefined ? {} : { body }),
  });
}

test("upload admission requires a positive safe declared length before reading", async () => {
  for (const length of [
    undefined,
    "0",
    "-1",
    "1.5",
    "invalid",
    "9007199254740992",
  ]) {
    const response = await exactLengthBody(request("x", length), 1024);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(411);
    expect(await (response as Response).json()).toEqual({
      error: "Content-Length is required",
    });
  }
  const tooLarge = (await exactLengthBody(
    request(undefined, "2097153"),
    2 * 1024 * 1024,
  )) as Response;
  expect(tooLarge.status).toBe(413);
  expect(await tooLarge.json()).toEqual({ error: "Body exceeds 2 MiB" });
});

test("upload admission reads exact bodies and refuses missing or short bodies", async () => {
  expect(await exactLengthBody(request("abc", "3"), 10)).toEqual(
    new TextEncoder().encode("abc"),
  );
  for (const body of [undefined, "ab"]) {
    const response = (await exactLengthBody(
      request(body, "3"),
      10,
    )) as Response;
    expect(response.status).toBe(400);
  }
});

test("overlong bodies retain each upload protocol's refusal status", async () => {
  const weights = (await exactLengthBody(request("abc", "2"), 10)) as Response;
  const image = await handleImageUpload(request("abc", "2"));
  expect(weights.status).toBe(413);
  expect(image.status).toBe(400);
  expect(await weights.json()).toEqual({
    error: "Body exceeds Content-Length",
  });
  expect(await image.json()).toEqual({ error: "Body exceeds Content-Length" });
});

test("an overlong stream is cancelled without consuming the remainder", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(3));
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = (await exactLengthBody(
    new Request("http://workbench/upload", {
      method: "PUT",
      headers: { "content-length": "2" },
      body,
    }),
    10,
  )) as Response;
  expect(response.status).toBe(413);
  expect(cancelled).toBe(true);
});
