import { describe, expect, test } from "bun:test";

import { instancesFromDetection } from "../../domain/annotation/detection";
import { AnnotationConflictError } from "../../domain/annotation/errors";
import type { AnnotationInstance } from "../../domain/annotation/schema";
import { observeImages } from "../testing/experiments";
import { imageDigest, resultFor } from "../testing/images";
import { seedDetectionResult } from "../testing/inference";
import { readAnnotation } from "../testing/records";
import { testHeartbeat } from "../testing/workers";
import { storeAnnotation } from "./documents";

/** Uploads one image, detects it, and returns the boxes a review begins from. */
async function detected(name: string, worker: string) {
  const { version } = await observeImages(name, [name]);
  const digest = await imageDigest(name);
  const result = await resultFor(version, name);
  await seedDetectionResult({ versionId: version.id, digest }, result, {
    runtimes: testHeartbeat(worker).runtimes,
  });
  return {
    version,
    result,
    ref: { digest, modelId: version.modelId },
    opening: instancesFromDetection(result),
  };
}

const box: AnnotationInstance = {
  id: "kept",
  class: "ungerminated",
  bbox: { x: 2, y: 3, width: 4, height: 5 },
};

describe("annotations", () => {
  test("a save stores the boxes as the review; a later save replaces it", async () => {
    const { ref, result, opening } = await detected(
      "lb-a",
      "annotations-worker",
    );
    expect(await readAnnotation(ref)).toBeNull();

    const stored = await storeAnnotation(ref, [...opening, box], null);
    expect(stored).toEqual({
      schemaVersion: 1,
      image: result.image,
      instances: [...opening, box],
    });
    expect(await readAnnotation(ref)).toEqual(stored);

    const emptied = await storeAnnotation(ref, [], stored.instances);
    expect(emptied.instances).toEqual([]);
    expect(await readAnnotation(ref)).toEqual(emptied);
  });

  test("refuses a box outside the image", async () => {
    const { ref, result } = await detected("lb-b", "annotations-image-worker");
    await expect(
      storeAnnotation(
        ref,
        [{ ...box, bbox: { ...box.bbox, x: result.image.width } }],
        null,
      ),
    ).rejects.toThrow(/exceeds image bounds/);
  });

  test("refuses a class the model does not define", async () => {
    const { ref } = await detected("lb-c", "annotations-class-worker");
    await expect(
      storeAnnotation(ref, [{ ...box, class: "weed" }], null),
    ).rejects.toThrow(/unknown class/);
  });
});

test("only one save can replace a shared base, including an unreviewed image", async () => {
  const { ref } = await detected("shared-draft", "shared-draft-worker");
  const contenders = await Promise.allSettled([
    storeAnnotation(ref, [box], null),
    storeAnnotation(ref, [{ ...box, id: "other" }], null),
  ]);
  expect(
    contenders.filter(({ status }) => status === "fulfilled"),
  ).toHaveLength(1);
  const rejected = contenders.find(({ status }) => status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
    AnnotationConflictError,
  );

  const base = (await readAnnotation(ref))!.instances;
  await storeAnnotation(ref, [], base);
  await expect(storeAnnotation(ref, [box], base)).rejects.toBeInstanceOf(
    AnnotationConflictError,
  );
  expect((await readAnnotation(ref))!.instances).toEqual([]);
});

test("a base compares content regardless of JSON object property order", async () => {
  const { ref } = await detected("draft-order", "draft-order-worker");
  await storeAnnotation(ref, [box], null);
  const base = [
    {
      bbox: { height: 5, width: 4, y: 3, x: 2 },
      class: "ungerminated",
      id: "kept",
    },
  ];
  await storeAnnotation(ref, [], base);
  expect((await readAnnotation(ref))!.instances).toEqual([]);
});

test("reviewing an absent canonical image uses the shared image refusal", async () => {
  await expect(
    storeAnnotation(
      { digest: "0".repeat(64), modelId: "seed-detector" },
      [],
      null,
    ),
  ).rejects.toMatchObject({ code: "image_not_found" });
});
