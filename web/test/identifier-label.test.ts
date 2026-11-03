import { expect, test } from "bun:test";

import { identifierLabel } from "../src/domain/identifiers/schema";

test("bare image digests and generated identifiers share the label rule", () => {
  const digest = "0123456789abcdef".repeat(4);
  expect(identifierLabel(digest)).toBe("01234567");
  expect(identifierLabel(`image-${digest}`)).toBe(identifierLabel(digest));
  expect(identifierLabel("0123456789abcdef")).toBe("0123456789abcdef");
  expect(identifierLabel("seed-detector")).toBe("seed-detector");
});
