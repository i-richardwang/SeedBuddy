import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import type { ModelArea } from "../../domain/models/area";
import {
  SEED_DETECTOR,
  SEED_DETECTOR_BASELINE_VERSION_ID,
} from "../../domain/models/builtins";
import { inferenceModeForArea } from "../../domain/models/inference";
import type { ModelVersion } from "../../domain/models/schema";
import {
  DEFAULT_MODEL_ANNOTATION,
  DEFAULT_MODEL_AREA,
} from "../../domain/models/schema";
import { YOLO26N_WHOLE_RECIPE } from "../../domain/training/recipes";
import { createDataset, readDatasetByName } from "../datasets/datasets";
import { database, operationTime, transaction } from "../infra/db/client";
import { datasetSnapshots, trainingRuns } from "../infra/db/schema";
import {
  readCurrentVersionId,
  readModelVersion,
  registerModel,
  registerModelVersion,
  setCurrentVersion,
} from "../models/registry";

/** The builtin seed germination model every deployment starts with. */
export async function baselineVersion(): Promise<ModelVersion> {
  const version = await readModelVersion(
    SEED_DETECTOR_BASELINE_VERSION_ID,
    await database(),
  );
  if (!version) throw new Error("builtin models are not registered");
  return version;
}

/**
 * A model of a test's own, with a traditional version the way a builtin ships:
 * the first one registered reads until another is chosen. A test that needs
 * several versions registers them here rather than against the builtin model
 * every other test observes with.
 */
export async function traditionalVersion(
  modelId: string,
  slug: string,
  createdAt = "2026-08-26T01:00:00.000Z",
): Promise<ModelVersion> {
  const db = await database();
  await registerModel(
    {
      schemaVersion: 1,
      id: modelId,
      name: `${modelId} detector`,
      task: "object_detection",
      classes: SEED_DETECTOR.classes,
      area: DEFAULT_MODEL_AREA,
      annotation: DEFAULT_MODEL_ANNOTATION,
    },
    db,
  );
  const version = await registerModelVersion(
    {
      schemaVersion: 1,
      id: `${modelId}.${slug}`,
      modelId,
      createdAt,
      source: { kind: "builtin", definition: slug },
      artifact: { kind: "traditional", digest: "c".repeat(64) },
    },
    db,
  );
  if ((await readCurrentVersionId(modelId, db)) === null) {
    await setCurrentVersion({ model: modelId, version: version.id });
  }
  return version;
}

/**
 * Registers a trained version of `modelId`, as a training run would publish
 * it: a candidate, which reads nothing until a test makes it current. The
 * area is the one its snapshot froze, and so the frame it reads in.
 */
export async function registerTrainedVersion(
  modelId: string,
  slug = "yolo-v1",
  area: ModelArea = "image",
): Promise<ModelVersion> {
  const datasetName = `${modelId}.${slug}.dataset`;
  const snapshotId = `${modelId}.${slug}.snapshot`;
  const runId = `${modelId}.${slug}.run`;
  const value: ModelVersion = {
    schemaVersion: 1,
    id: `${modelId}.${slug}`,
    modelId,
    createdAt: "2026-08-27T02:00:00.000Z",
    source: {
      kind: "training_run",
      trainingRunId: runId,
      trainingAttempt: 1,
      datasetSnapshotId: snapshotId,
    },
    artifact: {
      kind: "ultralytics",
      digest: createHash("sha256").update(`${modelId}.${slug}`).digest("hex"),
      weights: { digest: "c".repeat(64), bytes: 10 },
      inference: {
        confidence: 0.4,
        imageSize: 768,
        maxDetections: 500,
        endToEnd: false,
        mode: inferenceModeForArea(area),
      },
      validation: {
        precision: 0.6,
        recall: 0.5,
        map50: 0.8,
        map50To95: 0.4,
        fitness: 0.44,
      },
      training: YOLO26N_WHOLE_RECIPE,
    },
  };
  return transaction(async (db) => {
    const { id: datasetId } =
      (await readDatasetByName(datasetName, db)) ??
      (await createDataset({ name: datasetName, modelId }, db));
    await db
      .insert(datasetSnapshots)
      .values({
        id: snapshotId,
        datasetId,
        modelId,
        area,
        createdAt: await operationTime(db),
      })
      .onConflictDoNothing();
    await db
      .insert(trainingRuns)
      .values({
        id: runId,
        modelId,
        datasetSnapshotId: snapshotId,
        createdAt: new Date(value.createdAt),
        attempt: 1,
        recipe: YOLO26N_WHOLE_RECIPE,
        status: "queued",
      })
      .onConflictDoNothing();
    const version = await registerModelVersion(value, db);
    await db
      .update(trainingRuns)
      .set({ status: "succeeded", modelVersionId: version.id })
      .where(eq(trainingRuns.id, runId));
    return version;
  });
}

export async function trainedVersion(
  modelId: string,
  classes: string[] = SEED_DETECTOR.classes,
): Promise<ModelVersion> {
  const db = await database();
  await registerModel(
    {
      schemaVersion: 1,
      id: modelId,
      name: `${modelId} detector`,
      task: "object_detection",
      classes,
      area: DEFAULT_MODEL_AREA,
      annotation: DEFAULT_MODEL_ANNOTATION,
    },
    db,
  );
  const version = await registerTrainedVersion(modelId);
  await setCurrentVersion({ model: modelId, version: version.id });
  return version;
}
