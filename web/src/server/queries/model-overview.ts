import type { ModelCatalogueEntry } from "../../domain/models/contracts";
import type { ModelVersion } from "../../domain/models/schema";
import type {
  TrainingRunListing,
  VersionOverview,
} from "../../domain/training/read-model";
import type { DatasetSummary } from "../../domain/datasets/schema";
import { listDatasetSummaries } from "../datasets/public";
import { listAllModelVersions, readCurrentVersionId } from "../models/public";
import { datasetSnapshotSummaries } from "../training/public";
import { listTrainingRunSummaries } from "./training-runs";
import { modelCatalogue } from "./model-catalogue";
import { versionComparisons } from "./version-comparison";
import type {
  VersionComparison,
  VersionComparisonDetail,
} from "../../domain/models/comparison";

/** A model with what has been built for it. */
interface ModelOverview extends ModelCatalogueEntry {
  versions: VersionOverview[];
  /** The training sets of the model. */
  datasets: DatasetSummary[];
  /** The newest runs across those sets. */
  runs: TrainingRunListing[];
}

/**
 * Everything one model's page shows: its versions with how many images
 * trained each, which one reads and how each candidate compares with it,
 * the training sets that train it, and their runs.
 */
export async function modelOverview(
  modelId: string,
): Promise<ModelOverview | null> {
  const entry = (await modelCatalogue()).find(
    (item) => item.model.id === modelId,
  );
  if (!entry) return null;
  const [versions, datasets, runs] = await Promise.all([
    listVersionOverviews(modelId),
    listDatasetSummaries(modelId),
    listTrainingRunSummaries({ modelId }),
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
    versionComparisons(modelId),
    datasetSnapshotSummaries(
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
