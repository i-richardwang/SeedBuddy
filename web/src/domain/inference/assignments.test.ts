import fs from "node:fs";
import path from "node:path";

import { expect, test } from "bun:test";

import { inferenceAssignmentSchema } from "./assignments";

const CONTRACT_FIXTURES = [
  "inference-assignment.json",
  "inference-assignment-yolo.json",
].map((name) =>
  path.resolve(import.meta.dir, "../../../../tests/fixtures/contracts", name),
);

test("inference assignment contract loads both shared artifact variants", () => {
  const assignments = CONTRACT_FIXTURES.map((fixture) =>
    inferenceAssignmentSchema.parse(
      JSON.parse(fs.readFileSync(fixture, "utf-8")),
    ),
  );

  expect(
    assignments.map((assignment) => assignment.manifest.artifact.kind),
  ).toEqual(["traditional", "ultralytics"]);
  expect(assignments.map((assignment) => assignment.image)).toEqual([
    "c".repeat(64),
    "d".repeat(64),
  ]);
});
