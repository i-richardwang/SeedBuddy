/**
 * Model and version rows, written under two rules. Registration is write-once:
 * the same contents again are accepted, different contents under a registered
 * id are refused, so a deployment can install what it always has on every
 * start. Naming a task is a claim instead: the insert either takes the id or
 * finds it taken.
 */
import { and, desc, eq, isNull } from "drizzle-orm";

import {
  SEED_DETECTOR,
  SEED_DETECTOR_BASELINE,
} from "../../domain/models/builtins";
import {
  ModelNameTakenError,
  ModelNotFoundError,
  ModelUsageConflictError,
  ModelVersionNotFoundError,
} from "../../domain/models/errors";
import {
  DEFAULT_MODEL_ANNOTATION,
  type Model,
  type ModelAnnotationRequest,
  type ModelRef,
  type ModelRequest,
  type ModelVersion,
  type ModelVersionRef,
  modelSchema,
  modelVersionSchema,
  sameModel,
  sameModelVersion,
} from "../../domain/models/schema";
import {
  database,
  type Executor,
  inTransaction,
  single,
  transaction,
} from "../infra/db/client";
import { refusingUnique } from "../infra/db/errors";
import { models, modelVersions } from "../infra/db/schema";
import { heldBy, modelRecords } from "./records";

export function toModel(row: typeof models.$inferSelect): Model {
  return modelSchema.parse({
    schemaVersion: 1,
    id: row.id,
    name: row.name,
    task: row.task,
    classes: row.classes,
    annotation: row.annotation,
  });
}

export function toModelVersion(
  row: typeof modelVersions.$inferSelect,
): ModelVersion {
  return modelVersionSchema.parse({
    schemaVersion: 1,
    id: row.id,
    modelId: row.modelId,
    createdAt: row.createdAt.toISOString(),
    source: row.source,
    artifact: row.artifact,
  });
}

export async function readModel(
  modelId: string,
  db: Executor,
): Promise<Model | null> {
  const [row] = await db.select().from(models).where(eq(models.id, modelId));
  return row ? toModel(row) : null;
}

export async function requireModel(
  modelId: string,
  db: Executor,
): Promise<Model> {
  const model = await readModel(modelId, db);
  if (!model) throw new ModelNotFoundError(`Unknown model: ${modelId}`);
  return model;
}

/** Bounded version discovery for one model, in deterministic newest-first order. */
export async function listModelVersions(
  modelId: string,
): Promise<ModelVersion[]> {
  const db = await database();
  return (
    await db
      .select()
      .from(modelVersions)
      .where(eq(modelVersions.modelId, modelId))
      .orderBy(desc(modelVersions.createdAt), desc(modelVersions.id))
      .limit(100)
  ).map(toModelVersion);
}

export async function readModelVersion(
  versionId: string,
  db: Executor,
): Promise<ModelVersion | null> {
  const [row] = await db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.id, versionId));
  return row ? toModelVersion(row) : null;
}

/** Claims the id for this model, or nothing when the id is already claimed. */
async function insertModel(model: Model, db: Executor): Promise<Model | null> {
  const [inserted] = await db
    .insert(models)
    .values(modelColumns(model))
    .onConflictDoNothing()
    .returning();
  return inserted ? toModel(inserted) : null;
}

/**
 * Declares a model the deployment always has: the same one again is welcome.
 * Its annotation instructions are the deployment's to edit, so registration
 * supplies a starting point and never overrides what was changed since.
 */
export async function registerModel(
  model: Model,
  db: Executor,
): Promise<Model> {
  const inserted = await insertModel(model, db);
  if (inserted) return inserted;
  const existing = await readModel(model.id, db);
  if (
    !existing ||
    !sameModel(existing, { ...model, annotation: existing.annotation })
  ) {
    throw new Error(
      `Model ${model.id} is already registered with different contents`,
    );
  }
  return existing;
}

/**
 * Names a task the workbench did not have. Classes are fixed here because
 * every review already stored for the model was drawn from them; a task whose
 * vocabulary changed would be a different task under the same name.
 *
 * The insert is what claims the name, so two people naming the same task at
 * once get one model and one refusal.
 */
export async function createModel(
  request: ModelRequest,
  db?: Executor,
): Promise<Model> {
  const model = modelSchema.parse({
    schemaVersion: 1,
    task: "object_detection",
    ...request,
    annotation: { ...DEFAULT_MODEL_ANNOTATION, ...request.annotation },
  });
  db ??= await database();
  const created = single(
    await refusingUnique(
      "models_pkey",
      () => new ModelNameTakenError(`Model ${model.id} already exists`),
      () => db.insert(models).values(modelColumns(model)).returning(),
    ),
    "models",
  );
  return toModel(created);
}

/** Changes how agents annotate the task. Its classes and records are untouched. */
export async function setModelAnnotation(
  request: ModelAnnotationRequest,
  db?: Executor,
): Promise<Model> {
  db ??= await database();
  const [row] = await db
    .update(models)
    .set({ annotation: request.annotation })
    .where(eq(models.id, request.model))
    .returning();
  if (!row) throw new ModelNotFoundError(`Unknown model: ${request.model}`);
  return toModel(row);
}

/**
 * Forgets a task nothing has recorded against yet. The model row is taken
 * before anything is counted against it, so the count is of every record that
 * got there first, and one arriving after finds the task gone.
 */
export async function deleteModel(ref: ModelRef, db?: Executor): Promise<void> {
  await inTransaction(db, async (db) => {
    const [taken] = await db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.id, ref.model))
      .for("update");
    if (!taken) throw new ModelNotFoundError(`Unknown model: ${ref.model}`);
    const held = heldBy(await modelRecords(ref.model, db));
    if (held.length > 0) {
      throw new ModelUsageConflictError(
        `Model ${ref.model} is named by ${held.join(", ")} and cannot be deleted`,
      );
    }
    await db.delete(models).where(eq(models.id, ref.model));
  });
}

export async function registerModelVersion(
  version: ModelVersion,
  db: Executor,
): Promise<ModelVersion> {
  await requireModel(version.modelId, db);
  const [inserted] = await db
    .insert(modelVersions)
    .values({
      id: version.id,
      modelId: version.modelId,
      createdAt: new Date(version.createdAt),
      source: version.source,
      artifact: version.artifact,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return toModelVersion(inserted);
  const existing = await readModelVersion(version.id, db);
  if (!existing || !sameModelVersion(existing, version)) {
    throw new Error(
      `Model version ${version.id} is already registered with different contents`,
    );
  }
  return existing;
}

/** The version that reads for the model, or null while none has been chosen. */
export async function readCurrentVersionId(
  modelId: string,
  db: Executor,
): Promise<string | null> {
  const [row] = await db
    .select({ currentVersionId: models.currentVersionId })
    .from(models)
    .where(eq(models.id, modelId));
  if (!row) throw new ModelNotFoundError(`Unknown model: ${modelId}`);
  return row.currentVersionId;
}

/**
 * Makes one of the model's versions the one that reads its images. Every
 * observation for the model reads anew by it; detections of the version
 * left behind are kept, so choosing it again shows them at once. Reviews
 * and agent proposals belong to the image and model, not to a version, and
 * are untouched.
 */
export async function setCurrentVersion(
  ref: ModelVersionRef,
): Promise<ModelVersion> {
  return transaction(async (db) => {
    const version = await readModelVersion(ref.version, db);
    if (!version || version.modelId !== ref.model) {
      throw new ModelVersionNotFoundError(
        `${ref.model} has no version ${ref.version}`,
      );
    }
    await db
      .update(models)
      .set({ currentVersionId: version.id })
      .where(eq(models.id, ref.model));
    return version;
  });
}

export async function listModels(db?: Executor): Promise<Model[]> {
  db ??= await database();
  const rows = await db.select().from(models).orderBy(models.id);
  return rows.map(toModel);
}

/**
 * The models every deployment has: part of opening the database. The builtin
 * baseline reads until a person chooses another version, and never takes the
 * place of one they chose.
 */
export async function installBuiltinModels(db: Executor): Promise<void> {
  await registerModel(SEED_DETECTOR, db);
  await registerModelVersion(SEED_DETECTOR_BASELINE, db);
  await db
    .update(models)
    .set({ currentVersionId: SEED_DETECTOR_BASELINE.id })
    .where(
      and(eq(models.id, SEED_DETECTOR.id), isNull(models.currentVersionId)),
    );
}

function modelColumns(model: Model) {
  const { id, name, task, classes, annotation } = model;
  return { id, name, task, classes: [...classes], annotation };
}
