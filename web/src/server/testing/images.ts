import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import sharp from "sharp";

import { makeResult } from "../../domain/annotation/testing";
import type { DetectionResult } from "../../domain/detection/schema";
import type { DishCircle, ImageCoverage } from "../../domain/images/coverage";
import { DISH_GEOMETRY } from "../../domain/images/coverage";
import type { Tally } from "../../domain/models/classes";
import type { ModelVersion } from "../../domain/models/schema";
import { DISH_RECIPE_ID } from "../images/dish-recipe";
import { canonicalize } from "../images/ingest";
import { storeImage } from "../images/store";
import { database } from "../infra/db/client";
import { images } from "../infra/db/schema";
import { TEST_RUNTIME, ULTRALYTICS_RUNTIME } from "./workers";

/** A dish the fixture frame can hold, as ingestion would have recorded it. */
export const FIXTURE_DISH: DishCircle = { x: 32, y: 32, radius: 24 };

/** The coverage a dish task frames `FIXTURE_DISH` to. */
export const FIXTURE_COVERAGE: ImageCoverage = {
  kind: "dish",
  circle: FIXTURE_DISH,
  margin: DISH_GEOMETRY.coverageMargin,
};

/** Records that the image's analysis found `circle`, under the current recipe. */
export async function analyzedWithDish(
  digest: string,
  circle: DishCircle = FIXTURE_DISH,
): Promise<void> {
  await (
    await database()
  )
    .update(images)
    .set({ dishAnalysis: { recipe: DISH_RECIPE_ID, circle } })
    .where(eq(images.id, digest));
}

/** Fixture images are grids of flat blocks so lossy encoding keeps them distinct. */
const FIXTURE_BLOCKS = 8;

const FIXTURE_BLOCK_PIXELS = 8;

export const FIXTURE_EDGE = FIXTURE_BLOCKS * FIXTURE_BLOCK_PIXELS;

/** A source image whose pixels follow from `content`. */
export async function imageBytes(
  content: string,
  format: "png" | "jpeg" | "tiff" = "png",
): Promise<Uint8Array<ArrayBuffer>> {
  const seed = createHash("sha256").update(content).digest();
  const pixels = Buffer.alloc(FIXTURE_EDGE * FIXTURE_EDGE * 3);
  for (let y = 0; y < FIXTURE_EDGE; y += 1) {
    for (let x = 0; x < FIXTURE_EDGE; x += 1) {
      const block =
        Math.floor(y / FIXTURE_BLOCK_PIXELS) * FIXTURE_BLOCKS +
        Math.floor(x / FIXTURE_BLOCK_PIXELS);
      const offset = (y * FIXTURE_EDGE + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = seed[(block * 3 + channel) % seed.length]!;
      }
    }
  }
  const image = sharp(pixels, {
    raw: { width: FIXTURE_EDGE, height: FIXTURE_EDGE, channels: 3 },
  });
  const encoded =
    format === "png"
      ? image.png()
      : format === "jpeg"
        ? image.jpeg()
        : image.tiff();
  const encodedBytes = await encoded.toBuffer();
  const bytes = new Uint8Array(new ArrayBuffer(encodedBytes.byteLength));
  bytes.set(encodedBytes);
  return bytes;
}

/** The digest `imageBytes(content)` is stored under once it is canonicalised. */
export async function imageDigest(content: string): Promise<string> {
  return (await canonicalize(await imageBytes(content))).digest;
}

/** Stores one deterministic source per text, returning the digests in order. */
export async function storeTexts(contents: string[]): Promise<string[]> {
  const digests = [];
  for (const content of contents) {
    digests.push((await storeImage(await imageBytes(content))).digest);
  }
  return digests;
}

/** A result `version` would produce for the image with these bytes. */
export async function resultFor(
  version: ModelVersion,
  content: string,
  runtime = TEST_RUNTIME,
): Promise<DetectionResult> {
  return {
    ...makeResult([{ id: 0, x: 10, y: 10 }], {
      digest: await imageDigest(content),
      dishRadius: FIXTURE_EDGE / 4,
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
    }),
    producer: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime,
    },
  };
}

/** One box per instance the tally counts, laid along the top of the image. */
export function countedInstances(counted: Tally) {
  return Object.entries(counted)
    .flatMap(([name, total]) => Array.from({ length: total }, () => name))
    .map((name, index) => ({
      id: String(index),
      class: name,
      bbox: { x: index, y: 0, width: 1, height: 1 },
    }));
}

/** A detection by `version` that counts exactly the tally. */
export async function countedResult(
  version: ModelVersion,
  content: string,
  counted: Tally,
  runtime = TEST_RUNTIME,
): Promise<DetectionResult> {
  const result = await resultFor(version, content, runtime);
  return {
    ...result,
    instances: countedInstances(counted).map((instance) => ({
      ...instance,
      score: 0.9,
    })),
  };
}

export function countedImageResult(
  version: ModelVersion,
  digest: string,
  seeds: number,
  runtime = ULTRALYTICS_RUNTIME,
) {
  return {
    ...makeResult(
      Array.from({ length: seeds }, (_, id) => ({
        id,
        x: 12 + id * 14,
        y: 12,
      })),
      { digest, dishRadius: 400, width: FIXTURE_EDGE, height: FIXTURE_EDGE },
    ),
    producer: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime,
    },
  };
}
