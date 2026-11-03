import { ExperimentObservationImageNotFoundError } from "../../domain/experiments/errors";
import { randomUUID } from "node:crypto";

import { ModelNotFoundError } from "../../domain/models/errors";
import {
  DatasetModelError,
  DatasetNameTakenError,
  DatasetNotFoundError,
} from "../../domain/datasets/errors";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import { database, inTransaction, type Executor } from "../infra/db/client";
import { isUniqueViolation } from "../infra/db/errors";
import {
  datasetImages,
  datasets,
  experimentObservationImages,
  experimentObservations,
  type images as imageAssets,
} from "../infra/db/schema";
import {
  datasetSchema,
  type Dataset,
  type DatasetImageRef,
  type DatasetImageAddition,
  type DatasetImageAdditionResult,
  type DatasetRequest,
  type NewDatasetImageAddition,
  type DatasetUpdate,
  type DatasetImageRemoval,
  type DatasetImageRemovalResult,
} from "../../domain/datasets/schema";
import type { ObservationImageRef } from "../../domain/experiments/schema";
import { readModel } from "../models/public";
import type { ImageSplit } from "../../domain/training/schema";
import { imageBlobKey, lockImage } from "../images/public";

export interface DatasetImage extends DatasetImageRef {
  filename: string;
  width: number;
  height: number;
  bytes: number;
  blobKey: string;
  split: ImageSplit | null;
}

export type MembershipRow = {
  membership: typeof datasetImages.$inferSelect;
  image: typeof imageAssets.$inferSelect;
};

export function toDatasetImage({
  membership,
  image,
}: MembershipRow): DatasetImage {
  return {
    dataset: membership.datasetId,
    digest: image.id,
    filename: membership.filename,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    blobKey: imageBlobKey(image.id),
    split: membership.split,
  };
}

export function membershipOrder() {
  return [
    asc(datasetImages.addedAt),
    asc(datasetImages.filename),
    asc(datasetImages.imageId),
  ];
}

function toDataset(row: typeof datasets.$inferSelect): Dataset {
  return datasetSchema.parse({
    id: row.id,
    name: row.name,
    modelId: row.modelId,
  });
}

export async function readDataset(
  datasetId: string,
  db?: Executor,
): Promise<Dataset | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(datasets)
    .where(eq(datasets.id, datasetId));
  return row ? toDataset(row) : null;
}

/** The dataset of this name, whatever its case. */
export async function readDatasetByName(
  name: string,
  db?: Executor,
): Promise<Dataset | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(datasets)
    .where(sql`lower(${datasets.name}) = lower(${name})`);
  return row ? toDataset(row) : null;
}

export async function listDatasets(): Promise<Dataset[]> {
  const db = await database();
  const rows = await db.select().from(datasets).orderBy(asc(datasets.name));
  return rows.map(toDataset);
}

export async function listDatasetsForModel(
  modelId: string,
): Promise<Dataset[]> {
  const db = await database();
  const rows = await db
    .select()
    .from(datasets)
    .where(eq(datasets.modelId, modelId))
    .orderBy(asc(datasets.name));
  return rows.map(toDataset);
}

/** Two datasets cannot share a name, whatever its case. */
async function refuseTakenDatasetName<T>(
  name: string,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!isUniqueViolation(error, "datasets_name")) throw error;
    throw new DatasetNameTakenError(`A dataset named ${name} already exists`);
  }
}

export async function createDataset(
  { name, modelId }: DatasetRequest,
  executor?: Executor,
): Promise<Dataset> {
  return inTransaction(executor, async (tx) => {
    if (!(await readModel(modelId, tx))) {
      throw new ModelNotFoundError(`Unknown model: ${modelId}`);
    }
    const [row] = await refuseTakenDatasetName(name, () =>
      tx
        .insert(datasets)
        .values({ id: randomUUID(), name, modelId, createdAt: new Date() })
        .returning(),
    );
    if (!row) throw new Error("Dataset was not created");
    return toDataset(row);
  });
}

/** Renames the dataset; its images, splits, and training history stay. */
export async function updateDataset(
  { dataset: datasetId, name }: DatasetUpdate,
  executor?: Executor,
): Promise<Dataset> {
  return inTransaction(executor, async (tx) => {
    const [row] = await refuseTakenDatasetName(name, () =>
      tx
        .update(datasets)
        .set({ name })
        .where(eq(datasets.id, datasetId))
        .returning(),
    );
    if (!row) throw new DatasetNotFoundError(`Unknown dataset: ${datasetId}`);
    return toDataset(row);
  });
}

function describeObservationImage({
  experiment,
  observationImage,
}: ObservationImageRef): string {
  return `${experiment}/${observationImage}`;
}

function atObservationImage({
  experiment,
  observationImage,
}: ObservationImageRef) {
  return and(
    eq(experimentObservationImages.experimentId, experiment),
    eq(experimentObservationImages.id, observationImage),
  );
}

interface ObservedImage {
  digest: string;
  filename: string;
  modelId: string;
}

/** The experiment images named, which must all be observed for one model. */
async function resolveObservedImages(
  images: ObservationImageRef[],
  tx: Executor,
): Promise<{ modelId: string; observed: ObservedImage[] }> {
  const rows = await tx
    .select({
      experimentId: experimentObservationImages.experimentId,
      observationImageId: experimentObservationImages.id,
      digest: experimentObservationImages.imageId,
      filename: experimentObservationImages.filename,
      modelId: experimentObservations.modelId,
    })
    .from(experimentObservationImages)
    .innerJoin(
      experimentObservations,
      and(
        eq(
          experimentObservations.experimentId,
          experimentObservationImages.experimentId,
        ),
        eq(
          experimentObservations.id,
          experimentObservationImages.observationId,
        ),
      ),
    )
    .where(or(...images.map(atObservationImage)));
  const byRef = new Map(
    rows.map((row) => [
      describeObservationImage({
        experiment: row.experimentId,
        observationImage: row.observationImageId,
      }),
      row,
    ]),
  );
  const missing = images.filter(
    (image) => !byRef.has(describeObservationImage(image)),
  );
  if (missing.length > 0) {
    throw new ExperimentObservationImageNotFoundError(
      `Not experiment observation images: ${missing.map(describeObservationImage).join(", ")}`,
    );
  }
  const observed = images.map((image) =>
    byRef.get(describeObservationImage(image))!,
  );
  const modelIds = [...new Set(observed.map((row) => row.modelId))];
  if (modelIds.length > 1) {
    throw new DatasetModelError(
      `The images were observed for different models: ${modelIds.join(", ")}`,
    );
  }
  return { modelId: modelIds[0]!, observed };
}

async function insertMemberships(
  dataset: Dataset,
  observed: ObservedImage[],
  tx: Executor,
): Promise<DatasetImageAdditionResult> {
  const addedAt = new Date();
  const joining = new Map<string, string>();
  for (const row of observed) {
    if (!joining.has(row.digest)) joining.set(row.digest, row.filename);
  }
  const sorted = [...joining.keys()].sort();
  for (const digest of sorted) await lockImage(digest, tx);
  const created = await tx
    .insert(datasetImages)
    .values(
      sorted.map((digest) => ({
        datasetId: dataset.id,
        imageId: digest,
        filename: joining.get(digest)!,
        addedAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ imageId: datasetImages.imageId });
  return {
    dataset,
    added: created.length,
    existing: sorted.length - created.length,
  };
}

/** Adds experiment images atomically to a dataset for their observation's model. */
export async function addExperimentObservationImages(
  { dataset: datasetId, images }: DatasetImageAddition,
  executor?: Executor,
): Promise<DatasetImageAdditionResult> {
  return inTransaction(executor, async (tx) => {
    const dataset = await readDataset(datasetId, tx);
    if (!dataset) {
      throw new DatasetNotFoundError(`Unknown dataset: ${datasetId}`);
    }
    const { modelId, observed } = await resolveObservedImages(images, tx);
    if (dataset.modelId !== modelId) {
      throw new DatasetModelError(
        `Dataset ${dataset.name} trains ${dataset.modelId}, not ${modelId}`,
      );
    }
    return insertMemberships(dataset, observed, tx);
  });
}

/** Creates a dataset for the images' model and adds them, in one step. */
export async function addExperimentObservationImagesToNewDataset(
  { name, images }: NewDatasetImageAddition,
  executor?: Executor,
): Promise<DatasetImageAdditionResult> {
  return inTransaction(executor, async (tx) => {
    const { modelId, observed } = await resolveObservedImages(images, tx);
    const dataset = await createDataset({ name, modelId }, tx);
    return insertMemberships(dataset, observed, tx);
  });
}

/**
 * Removes images from the dataset atomically. Their reviews belong to the
 * image and the model, so they survive; the images outlive the membership
 * too, and snapshots already taken keep what they froze.
 */
export async function removeDatasetImages(
  value: DatasetImageRemoval,
  executor?: Executor,
): Promise<DatasetImageRemovalResult> {
  const { dataset: datasetId } = value;
  const digests = [...new Set(value.digests)];
  return inTransaction(executor, async (tx) => {
    const dataset = await readDataset(datasetId, tx);
    if (!dataset) {
      throw new DatasetNotFoundError(`Unknown dataset: ${datasetId}`);
    }
    const removed = await tx
      .delete(datasetImages)
      .where(
        and(
          eq(datasetImages.datasetId, datasetId),
          inArray(datasetImages.imageId, digests),
        ),
      )
      .returning({ imageId: datasetImages.imageId });
    return {
      dataset,
      removed: removed.length,
      absent: digests.length - removed.length,
    };
  });
}
