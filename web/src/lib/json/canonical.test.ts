import { expect, test } from "bun:test";

import { canonicalJson } from "./canonical";

test("canonical keys use code-unit order, including imported record keys", () => {
  expect(canonicalJson({ é: 1, z: { b: 1, A: 2 }, a: 3, Z: 4 })).toBe(
    '{"Z":4,"a":3,"z":{"A":2,"b":1},"é":1}',
  );
});
