import { WorkerSessionConflictError } from "../../../domain/workers/errors";
import {
  DetectionConflictError,
  DetectionImageNotFoundError,
  InvalidDetectionOutcomeError,
  ProducerMismatchError,
} from "../../../domain/inference/errors";
import { expect, spyOn, test } from "bun:test";

import {
  TrainingArtifactValidationError,
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../../domain/training/errors";

import { WorkerRequestError, workerErrorResponse } from "./worker";

test("worker HTTP errors answer with the status the protocol acts on", () => {
  const status = (error: Error) =>
    workerErrorResponse(error, "Operation failed").status;
  expect(status(new WorkerRequestError("invalid request"))).toBe(400);
  expect(status(new InvalidDetectionOutcomeError("bad outcome"))).toBe(400);
  expect(status(new TrainingRunNotFoundError("unknown run"))).toBe(404);
  expect(status(new DetectionImageNotFoundError("unknown image"))).toBe(404);
  expect(status(new WorkerSessionConflictError("replaced"))).toBe(409);
  expect(status(new TrainingRunConflictError("lease missing"))).toBe(409);
  expect(
    status(new DetectionConflictError({ versionId: "v", digest: "d" })),
  ).toBe(409);
  expect(status(new ProducerMismatchError("other runtime"))).toBe(422);
  expect(status(new TrainingArtifactValidationError("invalid"))).toBe(422);
});

test("worker HTTP errors hide unexpected server failures", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const response = workerErrorResponse(
      new Error("database connection string"),
      "Training operation failed",
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Training operation failed");
    expect(logged).toHaveBeenCalledTimes(1);
  } finally {
    logged.mockRestore();
  }
});
