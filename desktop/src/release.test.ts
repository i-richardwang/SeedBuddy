import { expect, test } from "bun:test";

import { newerRelease } from "./release";
import type { Fetch } from "./workbench";

const published =
  (...releases: unknown[]): Fetch =>
  async () =>
    Response.json(releases);

const tagged = (tag_name: string, more: object = {}) => ({
  tag_name,
  draft: false,
  prerelease: false,
  ...more,
});

test("the latest release after the running version is offered, by its page", async () => {
  const fetch = published(
    tagged("desktop-v0.2.0"),
    tagged("desktop-v0.10.1"),
    tagged("desktop-v0.9.3"),
  );

  expect(await newerRelease(fetch, "0.2.0")).toEqual({
    version: "0.10.1",
    page: "https://github.com/i-richardwang/SeedBuddy/releases/tag/desktop-v0.10.1",
  });
});

test("nothing is offered when the running version is the latest", async () => {
  const fetch = published(tagged("desktop-v0.2.0"), tagged("desktop-v0.1.0"));

  expect(await newerRelease(fetch, "0.2.0")).toBeNull();
});

test("only published releases of the app count", async () => {
  const fetch = published(
    tagged("v9.0.0"),
    tagged("desktop-v9.0.0", { draft: true }),
    tagged("desktop-v9.0.0", { prerelease: true }),
    tagged("desktop-v9.0.0-beta.1"),
    "desktop-v9.0.0",
    null,
  );

  expect(await newerRelease(fetch, "0.2.0")).toBeNull();
});

test("the releases are asked for without the window's cookies", async () => {
  const asked: { url: string; init?: RequestInit }[] = [];
  const fetch: Fetch = async (url, init) => {
    asked.push({ url, init });
    return Response.json([]);
  };

  await newerRelease(fetch, "0.2.0");

  expect(asked).toHaveLength(1);
  expect(asked[0]?.url).toBe(
    "https://api.github.com/repos/i-richardwang/SeedBuddy/releases?per_page=100",
  );
  expect(asked[0]?.init?.credentials).toBe("omit");
});

test("releases that cannot be read offer nothing", async () => {
  const refused: Fetch = async () => new Response("", { status: 403 });
  const garbled: Fetch = async () => new Response("<html>");
  const unreachable: Fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const unexpected: Fetch = async () => Response.json({ message: "Not Found" });

  for (const fetch of [refused, garbled, unreachable, unexpected])
    expect(await newerRelease(fetch, "0.2.0")).toBeNull();
});
