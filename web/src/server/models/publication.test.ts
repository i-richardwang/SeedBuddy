import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  type ModelBundle,
  modelBundleSchema,
} from "../../domain/models/bundle";
import { ModelUploadNotFoundError } from "../../domain/models/errors";
import { YOLO26N_WHOLE_RECIPE } from "../../domain/training/recipes";
import { blobExists } from "../infra/blobs/store";
import { database } from "../infra/db/client";
import { modelUploads } from "../infra/db/schema";
import { contentDigest } from "../infra/digest";
import {
  collectUnreferencedModelWeights,
  importModelUpload,
  openModelWeights,
  prepareModelUpload,
  uploadModelWeights,
} from "./publication";
import {
  createModel,
  readCurrentVersionId,
  setCurrentVersion,
} from "./registry";

const weights = new TextEncoder().encode("already-trained-weights");
function bundle(): ModelBundle {
  return {
    schemaVersion: 1,
    classes: ["seed"],
    weights: { digest: contentDigest(weights), bytes: weights.length },
    inference: {
      mode: "whole_image",
      iou: 0.7,
      confidence: 0.26,
      imageSize: 1536,
      maxDetections: 500,
      endToEnd: false,
    },
    training: YOLO26N_WHOLE_RECIPE,
    validation: {
      precision: 0.5,
      recall: 0.6,
      map50: 0.7,
      map50To95: 0.4,
      fitness: 0.4,
    },
    provenance: {
      dataset: {
        fingerprint: null,
        snapshotId: null,
        description: "External experiment; training membership unavailable",
      },
      selectedEpoch: 50,
      codeRevision: null,
      effectiveParameters: { nbs: 8 },
      evaluation: {
        description: "15 comparison images",
        calibration: "8 separate calibration images",
        metrics: { countMae: 17.5 },
      },
    },
  };
}
async function model(name: string) {
  return createModel({ id: name, name, classes: ["seed"] });
}

test("local artifacts register idempotently without a training run or changing the current version", async () => {
  const m = await model("import-independent");
  const manifest = bundle();
  const reservation = await prepareModelUpload(m.id, manifest);
  await expect(importModelUpload(reservation.uploadId)).rejects.toThrow(
    /Upload weights/,
  );
  await expect(
    uploadModelWeights(reservation.uploadId, new Uint8Array([1])),
  ).rejects.toThrow(/digest or size/);
  await uploadModelWeights(reservation.uploadId, weights);
  const v = await importModelUpload(reservation.uploadId);
  expect(v.source.kind).toBe("import");
  expect(await readCurrentVersionId(m.id, await database())).toBeNull();
  expect(await importModelUpload(reservation.uploadId)).toEqual(v);
  const again = await prepareModelUpload(m.id, manifest);
  expect(again.uploadId).toBe(reservation.uploadId);
  const downloaded = new Uint8Array(
    await new Response((await openModelWeights(v.id)).stream).arrayBuffer(),
  );
  expect(downloaded).toEqual(weights);
  await setCurrentVersion({ model: m.id, version: v.id });
  expect(await readCurrentVersionId(m.id, await database())).toBe(v.id);
  const revised = bundle();
  revised.inference.confidence = 0.4;
  const other = await prepareModelUpload(m.id, revised);
  await uploadModelWeights(other.uploadId, weights);
  const v2 = await importModelUpload(other.uploadId);
  expect(v2.id).not.toBe(v.id);
  expect(await readCurrentVersionId(m.id, await database())).toBe(v.id);
  await setCurrentVersion({ model: m.id, version: v2.id });
  await setCurrentVersion({ model: m.id, version: v.id });
  expect(await readCurrentVersionId(m.id, await database())).toBe(v.id);
});

test("bundle validation rejects mismatched classes and unsupported inference pipelines", async () => {
  const m = await model("import-validation");
  const b = bundle();
  b.classes = ["other"];
  await expect(prepareModelUpload(m.id, b)).rejects.toThrow(/classes/);
  expect(
    modelBundleSchema.safeParse({
      ...bundle(),
      inference: { ...bundle().inference, mode: "tiled" },
    }).success,
  ).toBeFalse();
});

test("only expired unregistered reservations are collected; renewal and committed versions remain rooted", async () => {
  const m = await model("import-collection");
  const a = await prepareModelUpload(m.id, bundle());
  await uploadModelWeights(a.uploadId, weights);
  const db = await database();
  const [row] = await db
    .select()
    .from(modelUploads)
    .where(eq(modelUploads.id, a.uploadId));
  expect(await collectUnreferencedModelWeights()).not.toContain(
    row!.weightsKey,
  );
  await db
    .update(modelUploads)
    .set({ expiresAt: new Date(0) })
    .where(eq(modelUploads.id, a.uploadId));
  await expect(importModelUpload(a.uploadId)).rejects.toThrow(/expired/);
  expect(await collectUnreferencedModelWeights()).toContain(row!.weightsKey);
  expect(await blobExists(row!.weightsKey)).toBeFalse();
  const renewed = await prepareModelUpload(m.id, bundle());
  await uploadModelWeights(renewed.uploadId, weights);
  const v = await importModelUpload(renewed.uploadId);
  await db
    .update(modelUploads)
    .set({ expiresAt: new Date(0) })
    .where(eq(modelUploads.id, renewed.uploadId));
  expect(await collectUnreferencedModelWeights()).not.toContain(
    row!.weightsKey,
  );
  expect((await openModelWeights(v.id)).size).toBe(weights.length);
});

test("an unknown upload has its own typed refusal", async () => {
  await expect(
    uploadModelWeights("unknown-upload", weights),
  ).rejects.toBeInstanceOf(ModelUploadNotFoundError);
  await expect(importModelUpload("unknown-upload")).rejects.toMatchObject({
    code: "model_upload_not_found",
  });
});
