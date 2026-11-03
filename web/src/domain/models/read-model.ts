import type { DatasetOverview } from "../datasets/read-model";
import type { TrainingRunOverview } from "../training/read-model";
import type { Tally } from "./classes";
import type { ModelRecords } from "./contracts";
import type { Model, ModelVersion } from "./schema";

export interface ModelOverview {
  model: Model;
  records: ModelRecords;
}
export interface ModelDetail extends ModelOverview {
  versions: VersionOverview[];
  datasets: DatasetOverview[];
  runs: TrainingRunOverview[];
}

export interface VersionOverview {
  version: ModelVersion;
  /**
   * The run that trained the version, in its training set, and how many
   * images it trained on; null for a built-in or imported version.
   */
  training: { runId: string; datasetId: string; images: number } | null;
  /** Whether this is the version that reads the model's images. */
  current: boolean;
  /**
   * How the version counts the reviewed images it was held out from, beside
   * the current version; null for the current version and for one that held
   * nothing out.
   */
  comparison: VersionComparison | null;
}

/**
 * What one version read for a held-out image: its tally, `failed` when the
 * version could not read it, or null while it has not.
 */
export type ComparedReading = Tally | "failed" | null;

/**
 * One validation image of a candidate's training snapshot: what the reviewer
 * counted when the snapshot froze it, and what each version reads.
 */
export interface ComparedImage {
  digest: string;
  /** The dataset the snapshot froze it from, while the image is still in it. */
  dataset: { id: string; filename: string } | null;
  reviewed: Tally;
  candidate: ComparedReading;
  /** Always null when the model has no current version. */
  current: ComparedReading;
}

/** How closely one version's counts match the reviewer's over the scored images. */
export interface CountAccuracy {
  /** Mean absolute count error per image, for each class of the model. */
  meanError: Record<string, number>;
}

interface ReadProgress {
  read: number;
  failed: number;
}

/**
 * A candidate set against the current version on the validation images the
 * candidate never trained on. Accuracy is scored only over the images both
 * have read, so the two numbers are always about the same images.
 */
export interface VersionComparison {
  /** The current version it is compared against, or null when there is none. */
  currentVersionId: string | null;
  heldOut: number;
  candidate: ReadProgress;
  current: ReadProgress | null;
  scored: number;
  accuracy: {
    candidate: CountAccuracy;
    current: CountAccuracy | null;
  } | null;
}

/** The comparison together with the images it was made on. */
export interface VersionComparisonDetail extends VersionComparison {
  images: ComparedImage[];
}
