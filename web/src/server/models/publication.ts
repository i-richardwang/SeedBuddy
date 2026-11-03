import { createHash } from "node:crypto";

import { and, eq, isNull, lt } from "drizzle-orm";

import {
  type ModelBundle,
  modelBundleSchema,
} from "../../domain/models/bundle";
import {
  ModelNotFoundError,
  ModelPublicationInvalidError,
  ModelVersionNotFoundError,
} from "../../domain/models/errors";
import {
  type ModelVersion,
  modelVersionSchema,
} from "../../domain/models/schema";
import { canonicalJson } from "../../lib/json/canonical";
import { openBlob, putImmutableBlob, removeBlob } from "../infra/blobs/store";
import { database, type Executor, transaction } from "../infra/db/client";
import { modelUploads, modelVersions } from "../infra/db/schema";
import { contentDigest, documentDigest } from "../infra/digest";
import { readModel, readModelVersion, registerModelVersion } from "./registry";

const UPLOAD_LIFETIME = 24 * 60 * 60 * 1000;

export function bundleDigest(bundle: ModelBundle): string {
  return documentDigest(bundle);
}

/** The adapter fingerprint; bundle identity additionally binds classes, runtime and provenance. */
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

export async function prepareModelUpload(modelId: string, value: ModelBundle) {
  const bundle = modelBundleSchema.parse(value);
  const model = await readModel(modelId);
  if (!model) throw new ModelNotFoundError(`Unknown model: ${modelId}`);
  if (canonicalJson(model.classes) !== canonicalJson(bundle.classes))
    throw new ModelPublicationInvalidError(
      "Bundle classes and their order must match the model",
    );
  const uploadId = `upload-${documentDigest({ modelId, bundle })}`;
  const expiresAt = new Date(Date.now() + UPLOAD_LIFETIME);
  const db = await database();
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
  await transaction(async (tx) => {
    const row = await requireUpload(uploadId, tx);
    if (
      weights.byteLength !== row.bundle.weights.bytes ||
      contentDigest(weights) !== row.bundle.weights.digest
    )
      throw new ModelPublicationInvalidError(
        "Weights differ from the bundle digest or size",
      );
    await putImmutableBlob(row.weightsKey, weights);
    await tx
      .update(modelUploads)
      .set({ artifactDigest: artifactDigest(weights, row.bundle) })
      .where(eq(modelUploads.id, uploadId));
  });
}

async function requireUpload(id: string, tx: Executor) {
  const [row] = await tx
    .select()
    .from(modelUploads)
    .where(eq(modelUploads.id, id))
    .for("update");
  if (!row) throw new ModelVersionNotFoundError(`Unknown model upload: ${id}`);
  if (!row.versionId && row.expiresAt.getTime() <= Date.now())
    throw new ModelPublicationInvalidError(
      "Upload expired; prepare the bundle again",
    );
  return row;
}

/** Called inside the owner's transaction: registration and run completion commit together. */
export async function registerUploadedModel(
  uploadId: string,
  source: Extract<ModelVersion["source"], { kind: "training_run" }> | undefined,
  tx: Executor,
): Promise<ModelVersion> {
  const row = await requireUpload(uploadId, tx);
  const origin: ModelVersion["source"] = source ?? {
    kind: "import",
    bundleDigest: bundleDigest(row.bundle),
    provenance: row.bundle.provenance,
  };
  const id = `version-${documentDigest({ modelId: row.modelId, bundle: row.bundle, source: origin })}`;
  const existing = await readModelVersion(id, tx);
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
      createdAt: new Date().toISOString(),
      source: origin,
      artifact: {
        kind: "ultralytics",
        digest: row.artifactDigest,
        weights: row.bundle.weights,
        inference: executableSettings(row.bundle),
        validation: row.bundle.validation,
        training: row.bundle.training,
      },
    }),
    tx,
  );
  await tx
    .update(modelVersions)
    .set({ weightsKey: row.weightsKey })
    .where(eq(modelVersions.id, id));
  await tx
    .update(modelUploads)
    .set({ versionId: id })
    .where(eq(modelUploads.id, uploadId));
  return version;
}

export async function importModelUpload(
  uploadId: string,
): Promise<ModelVersion> {
  return transaction((tx) => registerUploadedModel(uploadId, undefined, tx));
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
  const expired = await db
    .select({ id: modelUploads.id })
    .from(modelUploads)
    .where(
      and(
        isNull(modelUploads.versionId),
        lt(modelUploads.expiresAt, new Date()),
      ),
    );
  const removed: string[] = [];
  for (const { id } of expired)
    await transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(modelUploads)
        .where(eq(modelUploads.id, id))
        .for("update");
      if (!row || row.versionId || row.expiresAt.getTime() > Date.now()) return;
      await removeBlob(row.weightsKey);
      await tx.delete(modelUploads).where(eq(modelUploads.id, id));
      removed.push(row.weightsKey);
    });
  return removed;
}
