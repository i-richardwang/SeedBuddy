/** Composes experiment grids, unit series, and overview listings. */
import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
  cellKey,
  imageReview,
  observationCells,
} from "../../domain/experiments/cell-reading";
import { unitOrder } from "../../domain/experiments/naming";
import type {
  ExperimentGridDetail,
  ExperimentOverview,
  ExperimentSheetDetail,
  ObservationImageCell,
  UnitDetail,
  UnitRowOverview,
} from "../../domain/experiments/read-model";
import type {
  Experiment,
  ImageAnalysisState,
  UnitRef,
} from "../../domain/experiments/schema";
import { experimentSheet, unitRow } from "../../domain/experiments/sheet";
import {
  atImageObservation,
  listManualReadings,
  listObservations,
  listTreatments,
  listUnits,
  readExperimentRecord,
  toExperiment,
} from "../experiments/public";
import { markedUnclear } from "../images/public";
import { currentVersion } from "../inference/public";
import { type Executor, snapshot } from "../infra/db/client";
import {
  experimentObservationImages,
  experimentObservations,
  experiments,
  experimentTreatments,
  experimentUnits,
  inferenceTasks,
  modelVersions,
  images as storedImages,
} from "../infra/db/schema";
import { documentTally, readingsSubquery } from "../readings/public";
import { experimentObservationImageDetail } from "./experiment-observation-image-detail";

function observationImageGridQuery(db: Executor) {
  const readings = readingsSubquery(db, {
    modelId: experimentObservations.modelId,
    version: modelVersions.id,
  });
  return db
    .select({
      observationImage: experimentObservationImages,
      width: storedImages.width,
      height: storedImages.height,
      outcomeStatus: sql<
        "succeeded" | "failed" | null
      >`case when ${inferenceTasks.status} = 'failed' then 'failed' when ${readings.detection} is not null then 'succeeded' else null end`,
      detectionTally: documentTally(sql`${readings.detection}`),
      proposalTally: documentTally(sql`${readings.proposal}->'document'`),
      annotationTally: documentTally(sql`${readings.annotation}`),
      proposed: sql<boolean>`${readings.proposal} is not null`,
      reviewed: sql<boolean>`${readings.annotation} is not null`,
      reader: modelVersions.id,
      error: sql<
        string | null
      >`case when ${inferenceTasks.status} = 'failed' then ${inferenceTasks.error} else null end`,
      unclear: markedUnclear(experimentObservationImages.imageId),
    })
    .from(experimentObservationImages)
    .innerJoin(
      storedImages,
      eq(storedImages.id, experimentObservationImages.imageId),
    )
    .innerJoin(experimentObservations, atImageObservation())
    .leftJoin(
      modelVersions,
      eq(modelVersions.id, currentVersion(experimentObservations.modelId)),
    )
    .leftJoinLateral(
      readings,
      eq(readings.imageId, experimentObservationImages.imageId),
    )
    .leftJoin(
      inferenceTasks,
      and(
        eq(inferenceTasks.imageId, experimentObservationImages.imageId),
        eq(inferenceTasks.modelVersionId, modelVersions.id),
      ),
    );
}

type ObservationImageGridRow = Awaited<
  ReturnType<typeof observationImageGridQuery>
>[number];

function toCell(
  row: ObservationImageGridRow,
): ObservationImageCell & { width: number; height: number } {
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
    width: row.width,
    height: row.height,
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
): Promise<(ObservationImageCell & { width: number; height: number })[]> {
  const rows = await observationImageGridQuery(db).where(
    eq(experimentObservationImages.experimentId, experimentId),
  );
  return rows.map(toCell);
}

async function readGrid(experiment: Experiment, db: Executor) {
  const [treatments, units, observations, images, manualReadings] =
    await Promise.all([
      listTreatments(experiment.id, db),
      listUnits(experiment.id, db),
      listObservations(experiment.id, db),
      listObservationImageCells(experiment.id, db),
      listManualReadings(experiment.id, db),
    ]);
  return {
    grid: {
      experiment,
      treatments,
      units: unitOrder(units, treatments),
      observations,
      images: images.map(({ width: _width, height: _height, ...cell }) => cell),
      manualReadings,
    },
    images,
  };
}

export function experimentGridDetail(
  experimentId: string,
): Promise<ExperimentGridDetail | null> {
  return snapshot(async (db) => {
    const experiment = await readExperimentRecord(experimentId, db);
    return experiment ? (await readGrid(experiment, db)).grid : null;
  });
}

/** The experiment as an agent reads it: every cell resolved to its reading. */
export function experimentSheetDetail(
  experimentId: string,
): Promise<ExperimentSheetDetail | null> {
  return snapshot(async (db) => {
    const experiment = await readExperimentRecord(experimentId, db);
    return experiment
      ? experimentSheet((await readGrid(experiment, db)).grid)
      : null;
  });
}

/** One unit's row of the sheet, or nothing when experiment or unit is unknown. */
export function unitRowOverview(ref: UnitRef): Promise<UnitRowOverview | null> {
  return snapshot(async (db) => {
    const experiment = await readExperimentRecord(ref.experiment, db);
    return experiment
      ? unitRow((await readGrid(experiment, db)).grid, ref.unit)
      : null;
  });
}

export function unitDetail(
  ref: UnitRef,
  observationId?: string,
): Promise<UnitDetail | null> {
  return snapshot((db) => readUnitSeries(ref, observationId, db));
}

async function readUnitSeries(
  ref: UnitRef,
  observationId: string | undefined,
  db: Executor,
): Promise<UnitDetail | null> {
  const experiment = await readExperimentRecord(ref.experiment, db);
  if (!experiment) return null;
  const { grid, images: sizedImages } = await readGrid(experiment, db);
  const { treatments, units, observations, images, manualReadings } = grid;
  const unit = units.find((item) => item.id === ref.unit);
  if (!unit) return null;
  const cells = observationCells(images, manualReadings);
  const own = observations.map((observation) => ({
    observation,
    cell: cells.get(cellKey(unit.id, observation.id)),
  }));
  const series = own.map(({ observation, cell }) => ({
    observation,
    image:
      sizedImages.find(
        (image) =>
          image.unit === unit.id && image.observation === observation.id,
      ) ?? null,
    manual: cell?.manual ?? null,
  }));
  const viewing =
    observationId === undefined
      ? [...series].reverse().find((item) => item.image !== null)
      : series.find((item) => item.observation.id === observationId);
  if (observationId !== undefined && !viewing) return null;
  const shown = viewing?.image
    ? await experimentObservationImageDetail(
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
    navigation: units.map(({ id, code, treatment }) => {
      const image =
        viewing && cells.get(cellKey(id, viewing.observation.id))?.image;
      return { id, code, treatment, image: image ? imageReview(image) : null };
    }),
    observations: series,
    observation: viewing?.observation.id ?? null,
    shown,
  };
}

export function listExperimentOverviews(): Promise<ExperimentOverview[]> {
  return snapshot(queryExperimentOverviews);
}

/** Every experiment's id and name, newest first, for navigation. */
export function findExperimentNames(): Promise<{ id: string; name: string }[]> {
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

async function queryExperimentOverviews(
  db: Executor,
): Promise<ExperimentOverview[]> {
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
