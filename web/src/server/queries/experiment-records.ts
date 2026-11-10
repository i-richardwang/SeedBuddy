/**
 * Reads the records an experiment's views resolve their rows from: the
 * photographs placed on its units, each with what it reads under its day's
 * model, and the counts entered by hand. A view reads the records of the
 * units it shows, so what it costs follows the page, not the experiment;
 * the photographs are only counted over the whole experiment.
 */
import { and, count, eq, isNotNull, not, type SQL, sql } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";

import type {
  ExperimentDesign,
  ExperimentProgress,
  ExperimentRecords,
  ObservationImageCell,
} from "../../domain/experiments/read-model";
import type { ImageAnalysisState } from "../../domain/experiments/schema";
import type { Tally } from "../../domain/models/classes";
import {
  atImageObservation,
  listManualReadings,
  listUnits,
  type RecordScope,
  recordsIn,
  scopeOfRead,
  type UnitScope,
  type UnitWindow,
} from "../experiments/public";
import { markedUnclear } from "../images/public";
import type { Executor } from "../infra/db/client";
import {
  experimentObservationImages,
  experimentObservations,
  inferenceTasks,
  models,
  modelVersions,
} from "../infra/db/schema";
import {
  hasDetection,
  hasProposal,
  imageDetection,
  imageReadings,
} from "../readings/public";

/**
 * A placed photograph's readings under its day's model, and its detection by
 * the version that reads for the model now. Joined by `withReadings`.
 */
function dayReadings() {
  return {
    model: imageReadings({
      imageId: experimentObservationImages.imageId,
      modelId: experimentObservations.modelId,
    }),
    detection: imageDetection({
      imageId: experimentObservationImages.imageId,
      version: models.currentVersionId,
    }),
  };
}

type DayReadings = ReturnType<typeof dayReadings>;

/** Joins each placed photograph to its day and the day's model. */
function onTheirDays<Query extends PgSelect>(query: Query) {
  return query
    .innerJoin(experimentObservations, atImageObservation())
    .innerJoin(models, eq(models.id, experimentObservations.modelId));
}

/**
 * Joins each photograph, on its day, to its readings under the day's model
 * and to the task of the version that reads for the model now, which ends in
 * the detection or fails.
 */
function withReadings<Query extends PgSelect>(
  query: Query,
  { model, detection }: DayReadings,
) {
  return detection
    .join(model.join(query))
    .leftJoin(inferenceTasks, atReadingTask());
}

/** The task of the version that reads for a photograph's day's model now. */
function atReadingTask() {
  return and(
    eq(inferenceTasks.imageId, experimentObservationImages.imageId),
    eq(inferenceTasks.modelVersionId, models.currentVersionId),
  );
}

const taskFailed = sql<boolean>`${inferenceTasks.status} = 'failed'`;

/**
 * What a photograph's state turns on, beside its model's version and that
 * version's task: whether an agent's proposal stands for it, and whether the
 * version has detected it. A listing reads them off the photograph's
 * readings; a count asks them of every photograph at once.
 */
interface ReadingFacts {
  proposed: SQL;
  detected: SQL;
}

/** The facts as a photograph's joined readings show them. */
function factsOf({ model, detection }: DayReadings): ReadingFacts {
  return {
    proposed: model.proposed,
    detected: detection.detected,
  };
}

/**
 * Where a photograph stands under its day's model: proposed once an agent's
 * proposal stands for it, unread while the model has no version to read
 * with, failed or analyzed once that version's task has ended, and pending
 * until then.
 */
function imageState({ proposed, detected }: ReadingFacts) {
  return sql<ImageAnalysisState>`case
    when ${proposed} then 'proposed'
    when ${models.currentVersionId} is null then 'unread'
    when ${taskFailed} then 'failed'
    when ${detected} then 'analyzed'
    else 'pending' end`;
}

/**
 * The photographs `imageState` holds pending, as conditions a query can
 * answer for a whole experiment at once: in a filter, the facts asked by
 * `hasProposal` and `hasDetection` run as anti-joins, where inside the
 * state's `case` they would be asked of each photograph in turn.
 */
function pending({ proposed, detected }: ReadingFacts) {
  return and(
    not(proposed),
    isNotNull(models.currentVersionId),
    sql`${inferenceTasks.status} is distinct from 'failed'`,
    not(detected),
  );
}

/**
 * The classes a photograph's day's model declares that the version reading
 * for it now does not find, in the model's order; none while that version
 * has no detection of the photograph to show.
 */
function detectionUnfound({ detection }: DayReadings) {
  return sql<string[]>`case
    when ${taskFailed} or not ${detection.detected} then '[]'::jsonb
    else (
      select coalesce(jsonb_agg(declared.name order by declared.position), '[]'::jsonb)
      from jsonb_array_elements_text(${models.classes}) with ordinality as declared(name, position)
      where not exists (
        select 1 from ${modelVersions}
        where ${modelVersions.id} = ${models.currentVersionId}
          and ${modelVersions.classes} @> to_jsonb(declared.name)
      )
    ) end`;
}

/** The experiment's photographs in scope, each with what it reads. */
export async function listImageCells(
  experimentId: string,
  db: Executor,
  scope: RecordScope,
): Promise<ObservationImageCell[]> {
  const readings = dayReadings();
  return withReadings(
    onTheirDays(
      db
        .select({
          id: experimentObservationImages.id,
          unit: experimentObservationImages.unitId,
          observation: experimentObservationImages.observationId,
          digest: experimentObservationImages.imageId,
          filename: experimentObservationImages.filename,
          state: imageState(factsOf(readings)),
          detectionTally: sql<Tally | null>`case when ${taskFailed} then null else ${readings.detection.detectionTally} end`,
          detectionUnfound: detectionUnfound(readings),
          proposalTally: readings.model.proposalTally,
          annotationTally: readings.model.annotationTally,
          error: sql<
            string | null
          >`case when ${taskFailed} then ${inferenceTasks.error} else null end`,
          unclear: markedUnclear(experimentObservationImages.imageId),
        })
        .from(experimentObservationImages)
        .$dynamic(),
    ),
    readings,
  ).where(recordsIn(experimentObservationImages, experimentId, scope));
}

/**
 * The experiment's photographs counted: how many each observation holds,
 * an observation without any being absent, and how far they all have come.
 * The waiting are counted apart, so their filter runs as anti-joins over
 * the photographs alone.
 */
export async function countPhotographs(
  experimentId: string,
  db: Executor,
): Promise<{ byDay: Map<string, number>; progress: ExperimentProgress }> {
  const inExperiment = eq(
    experimentObservationImages.experimentId,
    experimentId,
  );
  const [held, [waiting]] = await Promise.all([
    db
      .select({
        observation: experimentObservationImages.observationId,
        photographs: count(),
      })
      .from(experimentObservationImages)
      .where(inExperiment)
      .groupBy(experimentObservationImages.observationId),
    onTheirDays(
      db
        .select({ waiting: count() })
        .from(experimentObservationImages)
        .$dynamic(),
    )
      .leftJoin(inferenceTasks, atReadingTask())
      .where(
        and(
          inExperiment,
          pending({
            proposed: hasProposal(
              experimentObservationImages.imageId,
              experimentObservations.modelId,
            ),
            detected: hasDetection(
              experimentObservationImages.imageId,
              models.currentVersionId,
            ),
          }),
        ),
      ),
  ]);
  return {
    byDay: new Map(held.map((row) => [row.observation, row.photographs])),
    progress: {
      photographs: held.reduce((sum, row) => sum + row.photographs, 0),
      waiting: waiting!.waiting,
    },
  };
}

/**
 * The records of the experiment's units in scope, in the experiment's order,
 * or of the run of them `window` names: the units with their culture events,
 * and their photographs and counts on every observation.
 */
export async function experimentRecords(
  design: ExperimentDesign,
  db: Executor,
  scope: UnitScope = "all",
  window?: UnitWindow,
): Promise<ExperimentRecords> {
  const experimentId = design.experiment.id;
  const units = await listUnits(experimentId, db, scope, window);
  const records: RecordScope = { units: scopeOfRead(scope, window, units) };
  const [images, manualReadings] = await Promise.all([
    listImageCells(experimentId, db, records),
    listManualReadings(experimentId, db, records),
  ]);
  return { ...design, units, images, manualReadings };
}
