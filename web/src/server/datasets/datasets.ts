import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import {
  DatasetModelMismatchError,
  DatasetNameTakenError,
  DatasetNotFoundError,
} from "../../domain/datasets/errors";
import {
  type Dataset,
  type DatasetImageAddition,
  type DatasetImageAdditionResult,
  type DatasetImageRef,
  type DatasetImageRemoval,
  type DatasetImageRemovalResult,
  type DatasetRequest,
  type DatasetUpdate,
  datasetSchema,
  type NewDatasetImageAddition,
  type ObservationPhotographs,
} from "../../domain/datasets/schema";
import { ExperimentObservationImageNotFoundError } from "../../domain/experiments/errors";
import type {
  ObservationImageRef,
  ObservationRef,
} from "../../domain/experiments/schema";
import type { ImageSplit } from "../../domain/training/schema";
import { lockImage } from "../images/public";
import {
  database,
  type Executor,
  inTransaction,
  operationTime,
  single,
  transaction,
} from "../infra/db/client";
import { refusingUnique } from "../infra/db/errors";
import {
  datasetImages,
  datasets,
  experimentObservationImages,
  experimentObservations,
  type images as imageAssets,
} from "../infra/db/schema";
import { requireModel } from "../models/public";

export interface DatasetImage extends DatasetImageRef {
  filename: string;
  width: number;
  height: number;
  bytes: number;
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
    split: membership.split,
  };
}

export function datasetMembershipOrder() {
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

export async function listDatasets(db?: Executor): Promise<Dataset[]> {
  db ??= await database();
  const rows = await db.select().from(datasets).orderBy(asc(datasets.name));
  return rows.map(toDataset);
}

export async function listDatasetsForModel(
  modelId: string,
  db?: Executor,
): Promise<Dataset[]> {
  db ??= await database();
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
  return refusingUnique(
    "datasets_name",
    () => new DatasetNameTakenError(`A dataset named ${name} already exists`),
    write,
  );
}

export async function createDataset(
  { name, modelId }: DatasetRequest,
  db?: Executor,
): Promise<Dataset> {
  return inTransaction(db, async (db) => {
    await requireModel(modelId, db);
    return insertDataset({ name, modelId }, await operationTime(db), db);
  });
}

/** Insert a dataset after the caller has resolved its model. */
export async function insertDataset(
  { name, modelId }: DatasetRequest,
  at: Date,
  db: Executor,
): Promise<Dataset> {
  const row = single(
    await refuseTakenDatasetName(name, () =>
      db
        .insert(datasets)
        .values({ id: randomUUID(), name, modelId, createdAt: at })
        .returning(),
    ),
    "datasets",
  );
  return toDataset(row);
}

/** Renames the dataset; its images, splits, and training history stay. */
export async function updateDataset(
  { dataset: datasetId, name }: DatasetUpdate,
  db?: Executor,
): Promise<Dataset> {
  return inTransaction(db, async (db) => {
    const [row] = await refuseTakenDatasetName(name, () =>
      db
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

/** The experiment's photographs with the model their observation reads for, to be narrowed. */
function observedImages(db: Executor) {
  return db
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
    .$dynamic();
}

/** Every photograph of one observation, all read for its model. */
async function resolveObservationImages(
  { experiment, observation }: ObservationRef,
  db: Executor,
): Promise<{ modelId: string; observed: ObservedImage[] }> {
  const observed = await observedImages(db).where(
    and(
      eq(experimentObservationImages.experimentId, experiment),
      eq(experimentObservationImages.observationId, observation),
    ),
  );
  const [first] = observed;
  if (!first) {
    throw new ExperimentObservationImageNotFoundError(
      `The observation holds no photographs: ${experiment}/${observation}`,
    );
  }
  return { modelId: first.modelId, observed };
}

/**
 * The experiment images named, or every photograph of the observation
 * named, which must all be observed for one model.
 */
async function resolveObservedImages(
  images: ObservationPhotographs,
  db: Executor,
): Promise<{ modelId: string; observed: ObservedImage[] }> {
  if (!Array.isArray(images)) return resolveObservationImages(images, db);
  const rows = await observedImages(db).where(
    or(...images.map(atObservationImage)),
  );
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
    throw new DatasetModelMismatchError(
      `The images were observed for different models: ${modelIds.join(", ")}`,
    );
  }
  const modelId = observed[0]!.modelId;
  return { modelId, observed };
}

async function insertMemberships(
  dataset: Dataset,
  observed: ObservedImage[],
  addedAt: Date,
  db: Executor,
): Promise<DatasetImageAdditionResult> {
  const joining = new Map<string, string>();
  for (const row of observed) {
    if (!joining.has(row.digest)) joining.set(row.digest, row.filename);
  }
  const sorted = [...joining.keys()].sort();
  for (const digest of sorted) await lockImage(digest, db);
  const created = await db
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
  db?: Executor,
): Promise<DatasetImageAdditionResult> {
  return inTransaction(db, async (db) => {
    const dataset = await readDataset(datasetId, db);
    if (!dataset) {
      throw new DatasetNotFoundError(`Unknown dataset: ${datasetId}`);
    }
    const { modelId, observed } = await resolveObservedImages(images, db);
    if (dataset.modelId !== modelId) {
      throw new DatasetModelMismatchError(
        `Dataset ${dataset.name} trains ${dataset.modelId}, not ${modelId}`,
      );
    }
    return insertMemberships(dataset, observed, await operationTime(db), db);
  });
}

/** Creates a dataset for the images' model and adds them, in one step. */
export async function addExperimentObservationImagesToNewDataset({
  name,
  images,
}: NewDatasetImageAddition): Promise<DatasetImageAdditionResult> {
  return transaction(async (db) => {
    const { modelId, observed } = await resolveObservedImages(images, db);
    const at = await operationTime(db);
    const dataset = await insertDataset({ name, modelId }, at, db);
    return insertMemberships(dataset, observed, at, db);
  });
}

/**
 * Removes images from the dataset atomically. Their reviews belong to the
 * image and the model, so they survive; the images outlive the membership
 * too, and snapshots already taken keep what they froze.
 */
export async function removeDatasetImages(
  value: DatasetImageRemoval,
  db?: Executor,
): Promise<DatasetImageRemovalResult> {
  const { dataset: datasetId } = value;
  const digests = [...new Set(value.digests)];
  return inTransaction(db, async (db) => {
    const dataset = await readDataset(datasetId, db);
    if (!dataset) {
      throw new DatasetNotFoundError(`Unknown dataset: ${datasetId}`);
    }
    const removed = await db
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
