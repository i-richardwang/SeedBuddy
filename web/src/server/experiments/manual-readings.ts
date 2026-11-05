import { and, eq, inArray, sql } from "drizzle-orm";

import { unitIsOnBench } from "../../domain/experiments/culture-events";
import { ManualReadingConflictError } from "../../domain/experiments/errors";
import type {
  ExperimentObservation,
  ManualReading,
  ManualReadingsRequest,
} from "../../domain/experiments/schema";
import type { Tally } from "../../domain/models/classes";
import { ClassInvalidError } from "../../domain/models/errors";
import {
  type Executor,
  inTransaction,
  operationTime,
} from "../infra/db/client";
import { experimentManualReadings } from "../infra/db/schema";
import { requireModel } from "../models/public";
import {
  listManualReadings,
  listObservations,
  lockExperiment,
  requireObservation,
  requireUnits,
} from "./records";

/**
 * A count a person enters answers the day's question: it names only classes
 * the day's model recognizes, and every class the day counts. A photograph's
 * tally may leave out a class it found none of; a person's count may not,
 * since nothing shows whether they counted it.
 */
function checkTally(
  tally: Tally,
  observation: ExperimentObservation,
  modelClasses: readonly string[],
  unitCode: string,
): void {
  const unknown = Object.keys(tally).filter(
    (name) => !modelClasses.includes(name),
  );
  if (unknown.length > 0) {
    throw new ClassInvalidError(
      `The model does not recognize ${unknown.length === 1 ? "class" : "classes"} counted for ${unitCode}: ${unknown.join(", ")}`,
    );
  }
  const unanswered = observation.countedClasses.filter(
    (name) => !Object.hasOwn(tally, name),
  );
  if (unanswered.length > 0) {
    throw new ManualReadingConflictError(
      `The count for ${unitCode} leaves out ${unanswered.length === 1 ? "a class" : "classes"} this day counts: ${unanswered.join(", ")}`,
    );
  }
}

/**
 * Records the counts people entered for units on one observation, in one
 * step: a tally replaces whatever count the unit had that day, and `null`
 * withdraws it. A unit removed from the bench before the observation can no
 * more be counted by hand than photographed. Returns the counts the
 * observation holds afterwards.
 */
export async function recordManualReadings(
  value: ManualReadingsRequest,
  db?: Executor,
): Promise<ManualReading[]> {
  const {
    experiment: experimentId,
    observation: observationId,
    readings: entries,
  } = value;
  return inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    const observations = await listObservations(experimentId, db);
    const observation = requireObservation(observations, observationId);
    const model = await requireModel(observation.modelId, db);
    const units = await requireUnits(
      experimentId,
      entries.map((entry) => entry.unit),
      db,
    );
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const counted = entries.flatMap((entry) =>
      entry.tally ? [{ unit: byId.get(entry.unit)!, tally: entry.tally }] : [],
    );
    const withdrawn = entries.flatMap((entry) =>
      entry.tally ? [] : [entry.unit],
    );
    const unavailable = counted.filter(
      ({ unit }) => !unitIsOnBench(unit.events, observations, observation),
    );
    if (unavailable.length > 0) {
      throw new ManualReadingConflictError(
        `Counts cannot be entered for units that left the bench before this observation: ${unavailable.map(({ unit }) => unit.code).join(", ")}`,
      );
    }
    for (const { unit, tally } of counted) {
      checkTally(tally, observation, model.classes, unit.code);
    }

    if (withdrawn.length > 0) {
      await db
        .delete(experimentManualReadings)
        .where(
          and(
            eq(experimentManualReadings.experimentId, experimentId),
            eq(experimentManualReadings.observationId, observationId),
            inArray(experimentManualReadings.unitId, withdrawn),
          ),
        );
    }
    if (counted.length > 0) {
      const recordedAt = await operationTime(db);
      await db
        .insert(experimentManualReadings)
        .values(
          counted.map(({ unit, tally }) => ({
            experimentId,
            unitId: unit.id,
            observationId,
            tally,
            recordedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [
            experimentManualReadings.experimentId,
            experimentManualReadings.unitId,
            experimentManualReadings.observationId,
          ],
          set: { tally: sql`excluded.tally`, recordedAt },
        });
    }
    return listManualReadings(experimentId, db, {
      units: "all",
      observation: observationId,
    });
  });
}
