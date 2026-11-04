import { expect, test } from "bun:test";

import { ByteCache } from "./bytes";

test("retained bytes are bounded and access determines eviction", () => {
  const cache = new ByteCache<Uint8Array>(6);
  cache.set("a", new Uint8Array(3));
  cache.set("b", new Uint8Array(3));
  expect(cache.get("a")).toHaveLength(3);
  cache.set("c", new Uint8Array(3));
  expect(cache.get("b")).toBeUndefined();
  cache.set("a", new Uint8Array(2));
  cache.set("d", new Uint8Array(1));
  expect(cache.get("c")).toHaveLength(3);
  cache.set("a", new Uint8Array(7));
  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("c")).toHaveLength(3);
  expect(cache.get("d")).toHaveLength(1);
});
