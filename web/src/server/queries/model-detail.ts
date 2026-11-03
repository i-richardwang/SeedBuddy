import { eq } from "drizzle-orm";

import type {
  ModelDetail,
  VersionComparison,
  VersionComparisonDetail,
  VersionOverview,
} from "../../domain/models/read-model";
import type { ModelVersion } from "../../domain/models/schema";
import { listDatasetOverviews } from "../datasets/public";
import { type Executor, snapshot } from "../infra/db/client";
import { models } from "../infra/db/schema";
import {
  listModelVersions,
  modelRecordCounts,
  readCurrentVersionId,
  toModel,
  toModelRecords,
} from "../models/public";
import { datasetSnapshotOverviews } from "../training/public";
import { findVersionComparisons } from "./find-version-comparisons";
import { listTrainingRunOverviews } from "./list-training-run-overviews";

/**
 * Everything one model's page shows: its versions with how many images
 * trained each, which one reads and how each candidate compares with it,
 * the training sets that train it, and their runs.
 */
export async function modelDetail(
  modelId: string,
): Promise<ModelDetail | null> {
  return snapshot(async (db) => {
    const [row] = await db
      .select({ model: models, ...modelRecordCounts(models.id, db) })
      .from(models)
      .where(eq(models.id, modelId));
    if (!row) return null;
    const entry = { model: toModel(row.model), records: toModelRecords(row) };
    const [versions, datasets, runs] = await Promise.all([
      listVersionOverviews(modelId, db),
      listDatasetOverviews(modelId, db),
      listTrainingRunOverviews({ modelId }, db),
    ]);
    return { ...entry, versions, datasets, runs };
  });
}

async function listVersionOverviews(
  modelId: string,
  db: Executor,
): Promise<VersionOverview[]> {
  const versions = await listModelVersions(modelId, db);
  const [currentVersionId, comparisons, snapshots] = await Promise.all([
    readCurrentVersionId(modelId, db),
    findVersionComparisons(modelId, undefined, db),
    datasetSnapshotOverviews(
      versions.flatMap((version) =>
        version.source.kind === "training_run"
          ? [version.source.datasetSnapshotId]
          : [],
      ),
      db,
    ),
  ]);
  return versions.map((version) => ({
    version,
    training: training(version, snapshots),
    current: version.id === currentVersionId,
    comparison: summary(comparisons.get(version.id)),
  }));
}

/** The run that trained a version, in the training set its snapshot was taken of. */
function training(
  version: ModelVersion,
  snapshots: Map<string, { datasetId: string; images: number }>,
): VersionOverview["training"] {
  if (version.source.kind !== "training_run") return null;
  const snapshot = snapshots.get(version.source.datasetSnapshotId);
  if (!snapshot) return null;
  return {
    runId: version.source.trainingRunId,
    datasetId: snapshot.datasetId,
    images: snapshot.images,
  };
}

/** A comparison without its images, which the page asks for one version at a time. */
function summary(
  detail: VersionComparisonDetail | undefined,
): VersionComparison | null {
  if (!detail) return null;
  const { images: _images, ...comparison } = detail;
  return comparison;
}
