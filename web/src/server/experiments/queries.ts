import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { inSnapshot, snapshot, type Executor } from "../infra/db/client";
import {
  annotations,
  experimentObservationImages,
  experimentObservations,
  experimentTreatments,
  experimentUnits,
  experiments,
  images as storedImages,
  inferenceOutcomes,
  inferenceTasks,
  modelVersions,
  models,
} from "../infra/db/schema";
import type {
  ExperimentGrid,
  ExperimentObservationImage,
  ExperimentSummary,
  ObservationImageCell,
  UnitSeries,
} from "../../domain/experiments/contracts";
import { unitOrder } from "../../domain/experiments/naming";
import {
  cellKey,
  imageReview,
  observationCells,
} from "../../domain/experiments/readings";
import {
  experimentSheet,
  unitRow,
  type ExperimentSheet,
  type UnitRow,
} from "../../domain/experiments/sheet";
import type {
  Experiment,
  ImageAnalysisState,
  ObservationImageRef,
  UnitRef,
} from "../../domain/experiments/schema";
import {
  listManualReadings,
  listObservations,
  listTreatments,
  listUnits,
  readExperimentRecord,
  requireObservation,
  toExperiment,
} from "./records";
import { toModel } from "../models/public";
import {
  documentTally,
  readReview,
  proposalRunId,
  proposalRuns,
} from "../readings/public";
import { currentVersion } from "../inference/public";
import { markedUnclear } from "../images/public";

function observationImageGridQuery(db: Executor) {
  return db
    .select({
      observationImage: experimentObservationImages,
      outcomeStatus: sql<
        "succeeded" | "failed" | null
      >`case when ${inferenceTasks.status} = 'failed' then 'failed' when ${inferenceOutcomes.imageId} is not null then 'succeeded' else null end`,
      detectionTally: documentTally(inferenceOutcomes.document),
      proposalTally: documentTally(sql`${proposalRuns.result}->'document'`),
      annotationTally: documentTally(annotations.document),
      proposed: sql<boolean>`${proposalRuns.id} is not null`,
      reviewed: sql<boolean>`${annotations.imageId} is not null`,
      reader: modelVersions.id,
      error: sql<
        string | null
      >`case when ${inferenceTasks.status} = 'failed' then ${inferenceTasks.error} else null end`,
      unclear: markedUnclear(experimentObservationImages.imageId),
    })
    .from(experimentObservationImages)
    .innerJoin(experimentObservations, atImageObservation())
    .leftJoin(
      modelVersions,
      eq(modelVersions.id, currentVersion(experimentObservations.modelId)),
    )
    .leftJoin(
      annotations,
      and(
        eq(annotations.imageId, experimentObservationImages.imageId),
        eq(annotations.modelId, experimentObservations.modelId),
      ),
    )
    .leftJoin(inferenceOutcomes, atImageOutcome())
    .leftJoin(
      inferenceTasks,
      and(
        eq(inferenceTasks.imageId, experimentObservationImages.imageId),
        eq(inferenceTasks.modelVersionId, modelVersions.id),
      ),
    )
    .leftJoin(proposalRuns, atImageProposal());
}

/** The observation an image was taken at. */
function atImageObservation() {
  return and(
    eq(
      experimentObservations.experimentId,
      experimentObservationImages.experimentId,
    ),
    eq(experimentObservations.id, experimentObservationImages.observationId),
  );
}

/** The newest agent proposal for the image under the observation's model. */
function atImageProposal() {
  return eq(
    proposalRuns.id,
    proposalRunId(
      experimentObservationImages.imageId,
      experimentObservations.modelId,
    ),
  );
}

/** The image's outcome under the version that currently reads for its model. */
function atImageOutcome() {
  return and(
    eq(inferenceOutcomes.imageId, experimentObservationImages.imageId),
    eq(inferenceOutcomes.modelVersionId, modelVersions.id),
  );
}

type ObservationImageGridRow = Awaited<
  ReturnType<typeof observationImageGridQuery>
>[number];

function toCell(row: ObservationImageGridRow): ObservationImageCell {
  const state: ImageAnalysisState = row.proposed
    ? "proposed"
    : row.reader === null
      ? "unread"
      : row.outcomeStatus === "succeeded"
        ? "analyzed"
        : row.outcomeStatus === "failed"
          ? "failed"
          : "pending";
  return {
    id: row.observationImage.id,
    unit: row.observationImage.unitId,
    observation: row.observationImage.observationId,
    digest: row.observationImage.imageId,
    filename: row.observationImage.filename,
    state,
    detectionTally:
      row.outcomeStatus === "succeeded" ? row.detectionTally : null,
    proposalTally: row.proposed ? row.proposalTally : null,
    annotationTally: row.reviewed ? row.annotationTally : null,
    error: row.error,
    unclear: row.unclear,
  };
}

async function listObservationImageCells(
  experimentId: string,
  db: Executor,
): Promise<ObservationImageCell[]> {
  const rows = await observationImageGridQuery(db).where(
    eq(experimentObservationImages.experimentId, experimentId),
  );
  return rows.map(toCell);
}

async function readGrid(
  experiment: Experiment,
  db: Executor,
): Promise<ExperimentGrid> {
  const [treatments, units, observations, images, manualReadings] =
    await Promise.all([
      listTreatments(experiment.id, db),
      listUnits(experiment.id, db),
      listObservations(experiment.id, db),
      listObservationImageCells(experiment.id, db),
      listManualReadings(experiment.id, db),
    ]);
  return {
    experiment,
    treatments,
    units: unitOrder(units, treatments),
    observations,
    images,
    manualReadings,
  };
}

export function readExperimentGrid(
  experimentId: string,
): Promise<ExperimentGrid | null> {
  return snapshot(async (db) => {
    const experiment = await readExperimentRecord(experimentId, db);
    return experiment ? readGrid(experiment, db) : null;
  });
}

/** The experiment as an agent reads it: every cell resolved to its reading. */
export function readExperimentSheet(
  experimentId: string,
): Promise<ExperimentSheet | null> {
  return snapshot(async (db) => {
    const experiment = await readExperimentRecord(experimentId, db);
    return experiment ? experimentSheet(await readGrid(experiment, db)) : null;
  });
}

/** One unit's row of the sheet, or nothing when experiment or unit is unknown. */
export function readUnitRow(ref: UnitRef): Promise<UnitRow | null> {
  return snapshot(async (db) => {
    const experiment = await readExperimentRecord(ref.experiment, db);
    return experiment
      ? unitRow(await readGrid(experiment, db), ref.unit)
      : null;
  });
}

export function readUnit(
  ref: UnitRef,
  observationId?: string,
): Promise<UnitSeries | null> {
  return snapshot((db) => readUnitSeries(ref, observationId, db));
}

async function readUnitSeries(
  ref: UnitRef,
  observationId: string | undefined,
  db: Executor,
): Promise<UnitSeries | null> {
  const experiment = await readExperimentRecord(ref.experiment, db);
  if (!experiment) return null;
  const [treatments, units, observations, images, manualReadings] =
    await Promise.all([
      listTreatments(ref.experiment, db),
      listUnits(ref.experiment, db),
      listObservations(ref.experiment, db),
      listObservationImageCells(ref.experiment, db),
      listManualReadings(ref.experiment, db),
    ]);
  const ordered = unitOrder(units, treatments);
  const unit = ordered.find((item) => item.id === ref.unit);
  if (!unit) return null;
  const cells = observationCells(images, manualReadings);
  const own = observations.map((observation) => ({
    observation,
    cell: cells.get(cellKey(unit.id, observation.id)),
  }));
  const sizes = await readImageSizes(
    own.flatMap(({ cell }) => (cell?.image ? [cell.image.digest] : [])),
    db,
  );
  const series = own.map(({ observation, cell }) => ({
    observation,
    image: cell?.image
      ? { ...cell.image, ...sizes.get(cell.image.digest)! }
      : null,
    manual: cell?.manual ?? null,
  }));
  const viewing =
    observationId === undefined
      ? [...series].reverse().find((item) => item.image !== null)
      : series.find((item) => item.observation.id === observationId);
  if (observationId !== undefined && !viewing) return null;
  const shown = viewing?.image
    ? await readExperimentObservationImage(
        {
          experiment: ref.experiment,
          observationImage: viewing.image.id,
        },
        db,
      )
    : null;
  return {
    experiment,
    unit,
    treatments,
    navigation: ordered.map(({ id, code, treatment }) => {
      const image =
        viewing && cells.get(cellKey(id, viewing.observation.id))?.image;
      return { id, code, treatment, image: image ? imageReview(image) : null };
    }),
    observations: series,
    observation: viewing?.observation.id ?? null,
    shown,
  };
}

/**
 * The size of each stored image named. An observation image refers to a
 * stored image, so every digest it gives is found.
 */
async function readImageSizes(
  digests: readonly string[],
  db: Executor,
): Promise<Map<string, { width: number; height: number }>> {
  const rows = await db
    .select({
      digest: storedImages.id,
      width: storedImages.width,
      height: storedImages.height,
    })
    .from(storedImages)
    .where(inArray(storedImages.id, [...digests]));
  return new Map(rows.map(({ digest, ...size }) => [digest, size]));
}

export function listExperiments(): Promise<ExperimentSummary[]> {
  return snapshot(listExperimentSummaries);
}

/** Every experiment's id and name, newest first, for navigation. */
export function listExperimentNames(): Promise<{ id: string; name: string }[]> {
  return snapshot((db) =>
    db
      .select({ id: experiments.id, name: experiments.name })
      .from(experiments)
      .orderBy(
        desc(experiments.createdAt),
        asc(experiments.name),
        asc(experiments.id),
      ),
  );
}

/**
 * The outer row's experiment id, qualified: a select from one table writes
 * its columns bare, which inside a subquery would name the inner table's own.
 */
const outerExperimentId = sql`${experiments}.${sql.identifier(experiments.id.name)}`;

/** How many rows of `table` belong to the experiment of the outer row. */
function countOf(
  table:
    | typeof experimentTreatments
    | typeof experimentUnits
    | typeof experimentObservations,
) {
  return sql<number>`(select count(*) from ${table} where ${table.experimentId} = ${outerExperimentId})`.mapWith(
    Number,
  );
}

async function listExperimentSummaries(
  db: Executor,
): Promise<ExperimentSummary[]> {
  const rows = await db
    .select({
      experiment: experiments,
      treatments: countOf(experimentTreatments),
      units: countOf(experimentUnits),
      observations: countOf(experimentObservations),
      lastObservedOn: sql<
        string | null
      >`(select max(${experimentObservations.observedOn})::text from ${experimentObservations} where ${experimentObservations.experimentId} = ${outerExperimentId})`,
    })
    .from(experiments)
    .orderBy(
      desc(experiments.createdAt),
      asc(experiments.name),
      asc(experiments.id),
    );
  return rows.map((row) => ({
    ...row,
    experiment: toExperiment(row.experiment),
  }));
}

function atObservationImage(experimentId: string, observationImageId: string) {
  return and(
    eq(experimentObservationImages.experimentId, experimentId),
    eq(experimentObservationImages.id, observationImageId),
  );
}

export function readExperimentObservationImage(
  ref: ObservationImageRef,
  executor?: Executor,
): Promise<ExperimentObservationImage | null> {
  return inSnapshot(executor, (db) => readObservationImage(ref, db));
}

async function readObservationImage(
  ref: ObservationImageRef,
  db: Executor,
): Promise<ExperimentObservationImage | null> {
  const [row] = await db
    .select({
      observationImage: experimentObservationImages,
      experiment: experiments,
      unit: experimentUnits,
      model: models,
      taskStatus: inferenceTasks.status,
      taskError: inferenceTasks.error,
      versionId: modelVersions.id,
      unclear: markedUnclear(experimentObservationImages.imageId),
    })
    .from(experimentObservationImages)
    .innerJoin(
      experiments,
      eq(experiments.id, experimentObservationImages.experimentId),
    )
    .innerJoin(experimentObservations, atImageObservation())
    .innerJoin(models, eq(models.id, experimentObservations.modelId))
    .leftJoin(
      modelVersions,
      eq(modelVersions.id, currentVersion(experimentObservations.modelId)),
    )
    .innerJoin(
      experimentUnits,
      and(
        eq(
          experimentUnits.experimentId,
          experimentObservationImages.experimentId,
        ),
        eq(experimentUnits.id, experimentObservationImages.unitId),
      ),
    )
    .leftJoin(inferenceOutcomes, atImageOutcome())
    .leftJoin(
      inferenceTasks,
      and(
        eq(inferenceTasks.imageId, experimentObservationImages.imageId),
        eq(inferenceTasks.modelVersionId, modelVersions.id),
      ),
    )
    .where(atObservationImage(ref.experiment, ref.observationImage));
  if (!row) return null;
  const experiment = toExperiment(row.experiment);
  const [observation, review] = await Promise.all([
    listObservations(ref.experiment, db).then((observations) =>
      requireObservation(observations, row.observationImage.observationId),
    ),
    readReview(
      { digest: row.observationImage.imageId, modelId: row.model.id },
      row.observationImage.filename,
      db,
    ),
  ]);
  if (!review) return null;
  return {
    ref,
    experimentName: experiment.name,
    unit: {
      id: row.unit.id,
      code: row.unit.code,
      treatment: row.unit.treatmentId,
    },
    observation,
    model: toModel(row.model),
    review,
    failure:
      row.taskStatus === "failed" && row.taskError && row.versionId
        ? {
            digest: row.observationImage.imageId,
            versionId: row.versionId,
            error: row.taskError,
          }
        : null,
    unclear: row.unclear,
  };
}
