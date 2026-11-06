import { expect, test } from "bun:test";

import {
  datasetSnapshotSchema,
  isTrainingRunActive,
  isTrainingRunResumable,
} from "./schema";

const DIGESTS = ["a".repeat(64), "b".repeat(64)];

function snapshotImage(digest: string, split: "train" | "val") {
  return {
    digest,
    width: 100,
    height: 80,
    split,
    coverage: null,
    annotation: {
      schemaVersion: 1 as const,
      image: { digest, width: 100, height: 80 },
      instances: [],
    },
  };
}

test("only queued and running training states are active", () => {
  expect(isTrainingRunActive({ state: { status: "queued" } })).toBeTrue();
  expect(
    isTrainingRunActive({
      state: {
        status: "running",
        workerId: "trainer",
        sessionId: "trainer-session",
        leaseExpiresAt: "2026-08-28T00:00:00.000Z",
        phase: "training",
        progress: 0.5,
      },
    }),
  ).toBeTrue();
  expect(
    isTrainingRunActive({
      state: { status: "succeeded", modelVersionId: "model.version" },
    }),
  ).toBeFalse();
  expect(
    isTrainingRunActive({ state: { status: "failed", error: "failed" } }),
  ).toBeFalse();
});

test("only paused and failed training states can resume", () => {
  expect(isTrainingRunResumable({ state: { status: "paused" } })).toBeTrue();
  expect(
    isTrainingRunResumable({ state: { status: "failed", error: "failed" } }),
  ).toBeTrue();
  expect(isTrainingRunResumable({ state: { status: "queued" } })).toBeFalse();
  expect(
    isTrainingRunResumable({ state: { status: "cancelled" } }),
  ).toBeFalse();
});

test("snapshot dimensions describe the canonical images", () => {
  const images = [
    snapshotImage(DIGESTS[0]!, "train"),
    snapshotImage(DIGESTS[1]!, "val"),
  ];
  const snapshot = {
    schemaVersion: 1 as const,
    id: "snapshot-seeds",
    datasetId: "seeds",
    modelId: "seeds",
    classes: ["seed"],
    area: "image" as const,
    createdAt: "2026-08-28T00:00:00.000Z",
    images,
  };
  expect(datasetSnapshotSchema.parse(snapshot).images).toHaveLength(2);
  expect(() =>
    datasetSnapshotSchema.parse({
      ...snapshot,
      images: [
        {
          ...images[0],
          annotation: {
            ...images[0]!.annotation,
            image: { ...images[0]!.annotation.image, width: 99 },
          },
        },
        images[1],
      ],
    }),
  ).toThrow(/dimensions/);
});

test("snapshot annotations use only the model's classes", () => {
  const images = [
    snapshotImage(DIGESTS[0]!, "train"),
    snapshotImage(DIGESTS[1]!, "val"),
  ];
  expect(() =>
    datasetSnapshotSchema.parse({
      schemaVersion: 1,
      id: "snapshot-seeds",
      datasetId: "seeds",
      modelId: "seeds",
      classes: ["seed"],
      area: "image",
      createdAt: "2026-08-28T00:00:00.000Z",
      images: [
        {
          ...images[0],
          annotation: {
            ...images[0]!.annotation,
            instances: [
              {
                id: "foreign-1",
                class: "foreign",
                bbox: { x: 1, y: 1, width: 2, height: 2 },
              },
            ],
          },
        },
        images[1],
      ],
    }),
  ).toThrow(/unknown class foreign/);
});
