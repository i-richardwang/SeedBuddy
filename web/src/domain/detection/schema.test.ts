import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { detectionResultSchema } from "./schema";

const CONTRACT_FIXTURE = path.resolve(
  import.meta.dir,
  "../../../../tests/fixtures/contracts/detection.json",
);

describe("detection contract", () => {
  test("loads the shared box-first contract fixture", () => {
    const outcome = detectionResultSchema.parse(
      JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf-8")),
    );

    expect(outcome.producer.modelVersionId).toBe("set.traditional-v1");
    expect(outcome.instances[0].bbox).toEqual({
      x: 10,
      y: 20,
      width: 8,
      height: 6,
    });
  });

  test("rejects boxes outside the image", () => {
    const document = JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf-8"));
    document.instances[0].bbox.x = 99;

    expect(detectionResultSchema.safeParse(document).success).toBe(false);
  });

  test("accepts implementation-specific warning codes", () => {
    const document = JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf-8"));
    document.quality.status = "review_required";
    document.quality.warnings = ["low_model_confidence"];

    expect(detectionResultSchema.safeParse(document).success).toBe(true);
  });

  test("rejects invalid scores and malformed image digests", () => {
    const document = JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf-8"));
    document.instances[0].score = 1.1;
    expect(detectionResultSchema.safeParse(document).success).toBe(false);

    document.instances[0].score = 0.9;
    document.image.digest = "example.jpg";
    expect(detectionResultSchema.safeParse(document).success).toBe(false);
  });
});

test("execution failures are not detection documents", () => {
  const result = JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf-8"));
  expect(
    detectionResultSchema.safeParse({
      schemaVersion: 1,
      image: { digest: result.image.digest },
      producer: result.producer,
      error: "transport failed",
    }).success,
  ).toBe(false);
});
