import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { annotationSchema } from "./schema";

const CONTRACT_FIXTURE = path.resolve(
  import.meta.dir,
  "../../../../tests/fixtures/contracts/annotation.json",
);

describe("annotation contract", () => {
  test("loads the shared contract fixture", () => {
    const document = annotationSchema.parse(
      JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf-8")),
    );

    expect(document.image.digest).toBe("c".repeat(64));
    expect(document.instances).toHaveLength(1);
  });

  test("requires an explicit schema version", () => {
    const document = JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf-8"));
    delete document.schemaVersion;

    expect(annotationSchema.safeParse(document).success).toBe(false);
  });
});
