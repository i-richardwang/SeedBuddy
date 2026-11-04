/** Reads an experiment’s units, observations, and image cells. */
import { and, eq, sql } from "drizzle-orm";

import { unitOrder } from "../../domain/experiments/naming";
import type { ObservationImageCell } from "../../domain/experiments/read-model";
import type {
  Experiment,
  ImageAnalysisState,
} from "../../domain/experiments/schema";
import {
  atImageObservation,
  listManualReadings,
  listObservations,
  listTreatments,
  listUnits,
} from "../experiments/public";
import { markedUnclear } from "../images/public";
import { currentVersion } from "../inference/public";
import type { Executor } from "../infra/db/client";
import {
  experimentObservationImages,
  experimentObservations,
  inferenceTasks,
  modelVersions,
  images as storedImages,
} from "../infra/db/schema";
import { documentTally, readingsSubquery } from "../readings/public";

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

export async function readGrid(experiment: Experiment, db: Executor) {
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
