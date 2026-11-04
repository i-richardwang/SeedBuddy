import { expect, test } from "bun:test";

import { businessFailureSchema } from "../domain/errors";
import {
  ExperimentNotFoundError,
  ExperimentObservationImageConflictError,
} from "../domain/experiments/errors";
import { withRequestLocale } from "../server/transport/http/locale";
import { errorMessage } from "../ui/errors";
import { mapBusinessErrors } from "./errors";

const handler = mapBusinessErrors.options.server!;
const context = {
  data: undefined,
  context: undefined,
  method: "POST" as const,
  serverFnMeta: { id: "test", name: "test", filename: "test" },
  signal: new AbortController().signal,
};

test("RPC maps a domain refusal to serializable data and translates it at the UI boundary", async () => {
  const error = new ExperimentNotFoundError(
    "Internal English record diagnostic",
  );
  let caught: unknown;
  try {
    await handler({
      ...context,
      next: async () => {
        throw error;
      },
    });
  } catch (failure) {
    caught = failure;
  }
  const wire: unknown = JSON.parse(JSON.stringify(caught));
  expect(businessFailureSchema.parse(wire)).toEqual({
    kind: "business_failure",
    code: "experiment_not_found",
    category: "not_found",
    details: {},
  });
  expect(JSON.stringify(wire)).not.toContain(error.message);
  withRequestLocale(
    new Request("http://localhost", {
      headers: { "accept-language": "zh-CN" },
    }),
    () => {
      expect(errorMessage(wire)).toContain("记录已不存在");
    },
  );
});

test("framework redirects and other control values pass through unchanged", async () => {
  const redirect = { isRedirect: true, to: "/login" };
  await expect(
    handler({
      ...context,
      next: async () => {
        throw redirect;
      },
    }),
  ).rejects.toBe(redirect);
});

test("business error details survive the wire without serializing exception internals", async () => {
  const images = [
    {
      digest: "a".repeat(64),
      filename: "seed.avif",
      unit: "A1",
      observedOn: "2026-08-03",
    },
  ];
  let caught: unknown;
  try {
    await handler({
      ...context,
      next: async () => {
        throw new ExperimentObservationImageConflictError(images);
      },
    });
  } catch (error) {
    caught = error;
  }
  const wire = businessFailureSchema.parse(JSON.parse(JSON.stringify(caught)));
  expect(wire.details).toEqual({ images });
  expect(wire.code).toBe("experiment_observation_image_conflict");
  expect(wire).not.toHaveProperty("stack");
});
