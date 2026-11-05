import { and, eq, exists, inArray, isNull, ne, sql } from "drizzle-orm";

import type {
  UnitDetailRead,
  UnitNavigation,
  UnitNavigationEntry,
} from "../../domain/experiments/read-model";
import type {
  ExperimentObservation,
  UnitRef,
} from "../../domain/experiments/schema";
import {
  atUnitTreatment,
  listManualReadings,
  listUnits,
  UNIT_ORDER,
  unitDeletionRefusal,
} from "../experiments/public";
import type { Executor } from "../infra/db/client";
import {
  annotations,
  experimentObservationImages,
  experimentTreatments,
  experimentUnits,
  images as storedImages,
} from "../infra/db/schema";
import { experimentDesign } from "./experiment-design";
import { experimentObservationImageDetail } from "./experiment-observation-image-detail";
import { listImageCells } from "./experiment-records";

/** The unit and day the workbench shows, and the treatment whose units it steps through, if one. */
export interface UnitView {
  observation?: string;
  treatment?: string;
}

/**
 * One unit through every observation, read from its own records, with where
 * it stands among the units the workbench steps through: the treatment's
 * named, where the unit is one of them. A treatment the unit is not of names
 * stepping through every unit instead, and nothing more is read.
 */
export async function unitDetail(
  ref: UnitRef,
  view: UnitView,
  db: Executor,
): Promise<UnitDetailRead | null> {
  const design = await experimentDesign(ref.experiment, db);
  if (!design) return null;
  const [unit] = await listUnits(ref.experiment, db, { units: [ref.unit] });
  if (!unit) return null;
  if (view.treatment !== undefined && view.treatment !== unit.treatment) {
    return { instead: { treatment: null } };
  }
  const own = { units: { units: [unit.id] } };
  const [images, manualReadings] = await Promise.all([
    listImageCells(ref.experiment, db, own),
    listManualReadings(ref.experiment, db, own),
  ]);
  const sizes = await readImageSizes(
    images.map((image) => image.digest),
    db,
  );
  const series = design.observations.map((observation) => {
    const image = images.find((item) => item.observation === observation.id);
    return {
      observation,
      image: image ? { ...image, ...sizes.get(image.digest)! } : null,
      manual:
        manualReadings.find((item) => item.observation === observation.id) ??
        null,
    };
  });
  const viewing =
    view.observation === undefined
      ? [...series].reverse().find((item) => item.image !== null)
      : series.find((item) => item.observation.id === view.observation);
  if (view.observation !== undefined && !viewing) return null;
  const treatment = view.treatment ?? null;
  const [navigation, deletionRefusal, shown] = await Promise.all([
    readNavigation(ref, treatment, viewing?.observation ?? null, db),
    unitDeletionRefusal(ref.experiment, unit, db),
    viewing?.image
      ? experimentObservationImageDetail(
          { experiment: ref.experiment, observationImage: viewing.image.id },
          db,
        )
      : null,
  ]);
  return {
    experiment: design.experiment,
    unit,
    treatments: design.treatments,
    navigation,
    removable: deletionRefusal === null,
    observations: series,
    observation: viewing?.observation.id ?? null,
    shown,
  };
}

/**
 * Where the unit stands among the units stepped through, in the
 * experiment's order: its position, its neighbours, and the units whose
 * photograph of the day in view awaits review. The database ranks the units;
 * none but the neighbours and the next to review is read.
 */
async function readNavigation(
  { experiment: experimentId, unit: unitId }: UnitRef,
  treatment: string | null,
  observation: ExperimentObservation | null,
  db: Executor,
): Promise<UnitNavigation> {
  const ranked = rankUnits(experimentId, treatment, db);
  const [stand] = await db
    .select({
      position: ranked.position,
      total: ranked.total,
      previous: ranked.previous,
      next: ranked.next,
    })
    .from(ranked)
    .where(eq(ranked.id, unitId));
  const { position, total, previous, next } = stand!;
  const review = observation
    ? await readReviewQueue(ranked, experimentId, position, observation, db)
    : { toReview: 0, nextToReview: null };
  return { treatment, position, total, previous, next, ...review };
}

/**
 * The units stepped through, the treatment's or every unit, each with its
 * position in the experiment's order, how many there are, and the units
 * before and after it. Its columns are named apart from any table's, so a
 * query nested in one over it reaches them.
 */
function rankUnits(
  experimentId: string,
  treatment: string | null,
  db: Executor,
) {
  const order = sql`over (order by ${sql.join(UNIT_ORDER, sql`, `)})`;
  const entry = sql`json_build_object('id', ${experimentUnits.id}, 'code', ${experimentUnits.code}, 'treatment', ${experimentUnits.treatmentId})`;
  return db
    .select({
      id: sql<string>`${experimentUnits.id}`.as("ranked_id"),
      code: sql<string>`${experimentUnits.code}`.as("ranked_code"),
      treatment: sql<string>`${experimentUnits.treatmentId}`.as(
        "ranked_treatment",
      ),
      position: sql<number>`row_number() ${order}`
        .mapWith(Number)
        .as("ranked_position"),
      total: sql<number>`count(*) over ()`.mapWith(Number).as("ranked_total"),
      previous: sql<UnitNavigationEntry | null>`lag(${entry}) ${order}`.as(
        "ranked_previous",
      ),
      next: sql<UnitNavigationEntry | null>`lead(${entry}) ${order}`.as(
        "ranked_next",
      ),
    })
    .from(experimentUnits)
    .innerJoin(experimentTreatments, atUnitTreatment())
    .where(
      and(
        eq(experimentUnits.experimentId, experimentId),
        treatment === null
          ? undefined
          : eq(experimentUnits.treatmentId, treatment),
      ),
    )
    .as("ranked");
}

/**
 * The units other than the one at `position` whose photograph of the day
 * awaits review: how many, and the next of them, after it and around again.
 */
async function readReviewQueue(
  ranked: ReturnType<typeof rankUnits>,
  experimentId: string,
  position: number,
  observation: ExperimentObservation,
  db: Executor,
): Promise<Pick<UnitNavigation, "toReview" | "nextToReview">> {
  const [next] = await db
    .select({
      id: ranked.id,
      code: ranked.code,
      treatment: ranked.treatment,
      queue: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(ranked)
    .where(
      and(
        ne(ranked.position, position),
        exists(
          db
            .select({ unit: experimentObservationImages.unitId })
            .from(experimentObservationImages)
            .leftJoin(
              annotations,
              and(
                eq(annotations.imageId, experimentObservationImages.imageId),
                eq(annotations.modelId, observation.modelId),
              ),
            )
            .where(
              and(
                eq(experimentObservationImages.experimentId, experimentId),
                eq(experimentObservationImages.unitId, ranked.id),
                eq(experimentObservationImages.observationId, observation.id),
                isNull(annotations.imageId),
              ),
            ),
        ),
      ),
    )
    .orderBy(sql`${ranked.position} < ${position}`, ranked.position)
    .limit(1);
  return next
    ? {
        toReview: next.queue,
        nextToReview: {
          id: next.id,
          code: next.code,
          treatment: next.treatment,
        },
      }
    : { toReview: 0, nextToReview: null };
}

/** The size of each stored image named; every digest a placed photograph gives is stored. */
async function readImageSizes(
  digests: readonly string[],
  db: Executor,
): Promise<Map<string, { width: number; height: number }>> {
  if (digests.length === 0) return new Map();
  const rows = await db
    .select({
      digest: storedImages.id,
      width: storedImages.width,
      height: storedImages.height,
    })
    .from(storedImages)
    .where(inArray(storedImages.id, [...digests]));
  return new Map(
    rows.map(({ digest, width, height }) => [digest, { width, height }]),
  );
}
