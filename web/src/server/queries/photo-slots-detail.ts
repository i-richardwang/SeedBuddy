import { eq } from "drizzle-orm";

import type { PhotoSlots } from "../../domain/experiments/read-model";
import type { ExperimentRef } from "../../domain/experiments/schema";
import {
  atObservation,
  atUnitTreatment,
  benchExits,
  readExperimentRecord,
  recordsIn,
  UNIT_ORDER,
} from "../experiments/public";
import { type Executor, snapshot } from "../infra/db/client";
import {
  experimentObservationImages,
  experimentObservations,
  experimentTreatments,
  experimentUnits,
} from "../infra/db/schema";

/**
 * The units a day's photographs are placed on: every unit of the experiment
 * by its code, in the experiment's order, with the day it left the bench,
 * so the day chosen decides which can take one; and, for a day already
 * recorded, the units it holds a photograph of. Nothing for an unknown
 * experiment or observation.
 */
export function photoSlotsDetail(
  ref: ExperimentRef & { observation?: string },
): Promise<PhotoSlots | null> {
  const { experiment, observation } = ref;
  return snapshot(async (db) => {
    if (!(await readExperimentRecord(experiment, db))) return null;
    if (observation === undefined) {
      return { units: await listSlots(experiment, db), taken: [] };
    }
    if (!(await observationExists(experiment, observation, db))) return null;
    const [units, taken] = await Promise.all([
      listSlots(experiment, db),
      listTaken(experiment, observation, db),
    ]);
    return { units, taken };
  });
}

async function observationExists(
  experimentId: string,
  observationId: string,
  db: Executor,
): Promise<boolean> {
  const [row] = await db
    .select({ id: experimentObservations.id })
    .from(experimentObservations)
    .where(atObservation(experimentId, observationId));
  return row !== undefined;
}

function listSlots(experimentId: string, db: Executor) {
  const exits = benchExits(experimentId, db);
  return db
    .select({
      id: experimentUnits.id,
      code: experimentUnits.code,
      leftOn: exits.leftOn,
    })
    .from(experimentUnits)
    .innerJoin(experimentTreatments, atUnitTreatment())
    .leftJoin(exits, eq(exits.unit, experimentUnits.id))
    .where(eq(experimentUnits.experimentId, experimentId))
    .orderBy(...UNIT_ORDER);
}

async function listTaken(
  experimentId: string,
  observationId: string,
  db: Executor,
): Promise<string[]> {
  const rows = await db
    .select({ unit: experimentObservationImages.unitId })
    .from(experimentObservationImages)
    .where(
      recordsIn(experimentObservationImages, experimentId, {
        units: "all",
        observation: observationId,
      }),
    );
  return rows.map((row) => row.unit);
}
