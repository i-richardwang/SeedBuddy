import { createHash } from "node:crypto";

import { and, eq, isNull, lt } from "drizzle-orm";

import type { ModelBundle } from "../../domain/models/bundle";
import { sameClasses } from "../../domain/models/classes";
import {
  ModelPublicationInvalidError,
  ModelUploadNotFoundError,
  ModelVersionNotFoundError,
} from "../../domain/models/errors";
import {
  type ModelVersion,
  modelVersionSchema,
} from "../../domain/models/schema";
import { canonicalJson } from "../../lib/json/canonical";
import { openBlob, putImmutableBlob, removeBlob } from "../infra/blobs/store";
import {
  database,
  type Executor,
  operationTime,
  transaction,
} from "../infra/db/client";
import { modelUploads, modelVersions } from "../infra/db/schema";
import { contentDigest, documentDigest } from "../infra/digest";
import {
  readModelVersion,
  registerModelVersion,
  requireModel,
} from "./registry";

/** A bundle's registered identity includes its provenance and execution source. */
export function modelBundleVersionId(
  modelId: string,
  bundle: ModelBundle,
  source: ModelVersion["source"],
): string {
  return `version-${documentDigest({ modelId, bundle, source })}`;
}

const UPLOAD_LIFETIME = 24 * 60 * 60 * 1000;

function bundleDigest(bundle: ModelBundle): string {
  return documentDigest(bundle);
}

/**
 * The adapter fingerprint: the weights and the numeric settings they run
 * under. Bundle identity additionally binds classes, runtime and provenance;
 * the frame a version reads in is recorded on its artifact, not hashed.
 */
function artifactDigest(weights: Uint8Array, bundle: ModelBundle): string {
  return createHash("sha256")
    .update(weights)
    .update("\0")
    .update(canonicalJson(executableSettings(bundle)))
    .digest("hex");
}
function executableSettings(bundle: ModelBundle) {
  const { confidence, imageSize, maxDetections, endToEnd } = bundle.inference;
  return { confidence, imageSize, maxDetections, endToEnd };
}

export async function prepareModelUpload(modelId: string, bundle: ModelBundle) {
  const db = await database();
  const model = await requireModel(modelId, db);
  if (!sameClasses(model.classes, bundle.classes))
    throw new ModelPublicationInvalidError(
      "Bundle classes and their order must match the model",
    );
  const uploadId = `upload-${documentDigest({ modelId, bundle })}`;
  const at = await operationTime(db);
  const expiresAt = new Date(at.getTime() + UPLOAD_LIFETIME);
  await db
    .insert(modelUploads)
    .values({
      id: uploadId,
      modelId,
      bundle,
      weightsKey: `model-artifacts/${uploadId}/${bundle.weights.digest}`,
      expiresAt,
    })
    .onConflictDoUpdate({ target: modelUploads.id, set: { expiresAt } });
  return {
    uploadId,
    uploadPath: `/api/agent/model-uploads/${uploadId}/weights`,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Uploads lock only their own reservation, never a training run or control operation. */
export async function uploadModelWeights(
  uploadId: string,
  weights: Uint8Array,
): Promise<void> {
  await transaction(async (db) => {
    const at = await operationTime(db);
    const row = await requireUpload(uploadId, at, db);
    if (
      weights.byteLength !== row.bundle.weights.bytes ||
      contentDigest(weights) !== row.bundle.weights.digest
    )
      throw new ModelPublicationInvalidError(
        "Weights differ from the bundle digest or size",
      );
    await putImmutableBlob(row.weightsKey, weights);
    await db
      .update(modelUploads)
      .set({ artifactDigest: artifactDigest(weights, row.bundle) })
      .where(eq(modelUploads.id, uploadId));
  });
}

async function requireUpload(id: string, at: Date, db: Executor) {
  const [row] = await db
    .select()
    .from(modelUploads)
    .where(eq(modelUploads.id, id))
    .for("update");
  if (!row) throw new ModelUploadNotFoundError(`Unknown model upload: ${id}`);
  if (!row.versionId && row.expiresAt <= at)
    throw new ModelPublicationInvalidError(
      "Upload expired; prepare the bundle again",
    );
  return row;
}

/** Called inside the owner's transaction: registration and run completion commit together. */
export async function registerUploadedModel(
  uploadId: string,
  options: {
    source?: Extract<ModelVersion["source"], { kind: "training_run" }>;
  },
  at: Date,
  db: Executor,
): Promise<ModelVersion> {
  const row = await requireUpload(uploadId, at, db);
  const origin: ModelVersion["source"] = options.source ?? {
    kind: "import",
    bundleDigest: bundleDigest(row.bundle),
    provenance: row.bundle.provenance,
  };
  const id = modelBundleVersionId(row.modelId, row.bundle, origin);
  const existing = await readModelVersion(id, db);
  if (existing) return existing;
  if (!row.artifactDigest)
    throw new ModelPublicationInvalidError(
      "Upload weights before registering the version",
    );
  const version = await registerModelVersion(
    modelVersionSchema.parse({
      schemaVersion: 1,
      id,
      modelId: row.modelId,
      createdAt: at.toISOString(),
      source: origin,
      artifact: {
        kind: "ultralytics",
        digest: row.artifactDigest,
        weights: row.bundle.weights,
        inference: {
          ...executableSettings(row.bundle),
          mode: row.bundle.inference.mode,
        },
        validation: row.bundle.validation,
        training: row.bundle.training,
      },
    }),
    db,
  );
  await db
    .update(modelVersions)
    .set({ weightsKey: row.weightsKey })
    .where(eq(modelVersions.id, id));
  await db
    .update(modelUploads)
    .set({ versionId: id })
    .where(eq(modelUploads.id, uploadId));
  return version;
}

export async function importModelUpload(
  uploadId: string,
): Promise<ModelVersion> {
  return transaction(async (db) =>
    registerUploadedModel(uploadId, {}, await operationTime(db), db),
  );
}

export async function openModelWeights(versionId: string) {
  const db = await database();
  const [row] = await db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.id, versionId));
  if (!row)
    throw new ModelVersionNotFoundError(`Unknown model version: ${versionId}`);
  if (!row.weightsKey || row.artifact.kind !== "ultralytics")
    throw new ModelPublicationInvalidError(
      "Version has no downloadable weights",
    );
  const blob = await openBlob(row.weightsKey);
  if (!blob || blob.size !== row.artifact.weights.bytes)
    throw new Error("Published model weights are missing or corrupt");
  return blob;
}

/** Reservation locks serialize collection with upload and registration. Registered bytes remain rooted by versions. */
export async function collectUnreferencedModelWeights(): Promise<string[]> {
  const db = await database();
  const at = await operationTime(db);
  const expired = await db
    .select({ id: modelUploads.id })
    .from(modelUploads)
    .where(and(isNull(modelUploads.versionId), lt(modelUploads.expiresAt, at)));
  const removed: string[] = [];
  for (const { id } of expired)
    await transaction(async (db) => {
      const at = await operationTime(db);
      const [row] = await db
        .select()
        .from(modelUploads)
        .where(eq(modelUploads.id, id))
        .for("update");
      if (!row || row.versionId || row.expiresAt > at) return;
      await removeBlob(row.weightsKey);
      await db.delete(modelUploads).where(eq(modelUploads.id, id));
      removed.push(row.weightsKey);
    });
  return removed;
}
