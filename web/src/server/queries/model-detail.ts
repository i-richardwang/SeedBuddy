import type {
  ModelDetail,
  VersionComparison,
  VersionComparisonDetail,
  VersionOverview,
} from "../../domain/models/read-model";
import type { ModelVersion } from "../../domain/models/schema";
import { listDatasetOverviews } from "../datasets/public";
import { listAllModelVersions, readCurrentVersionId } from "../models/public";
import { datasetSnapshotOverviews } from "../training/public";
import { findVersionComparisons } from "./find-version-comparisons";
import { listModelOverviews } from "./list-model-overviews";
import { listTrainingRunOverviews } from "./list-training-run-overviews";

/**
 * Everything one model's page shows: its versions with how many images
 * trained each, which one reads and how each candidate compares with it,
 * the training sets that train it, and their runs.
 */
export async function modelDetail(
  modelId: string,
): Promise<ModelDetail | null> {
  const entry = (await listModelOverviews()).find(
    (item) => item.model.id === modelId,
  );
  if (!entry) return null;
  const [versions, datasets, runs] = await Promise.all([
    listVersionOverviews(modelId),
    listDatasetOverviews(modelId),
    listTrainingRunOverviews({ modelId }),
  ]);
  return { ...entry, versions, datasets, runs };
}

async function listVersionOverviews(
  modelId: string,
): Promise<VersionOverview[]> {
  const versions = (await listAllModelVersions()).filter(
    (version) => version.modelId === modelId,
  );
  const [currentVersionId, comparisons, snapshots] = await Promise.all([
    readCurrentVersionId(modelId),
    findVersionComparisons(modelId),
    datasetSnapshotOverviews(
      versions.flatMap((version) =>
        version.source.kind === "training_run"
          ? [version.source.datasetSnapshotId]
          : [],
      ),
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
