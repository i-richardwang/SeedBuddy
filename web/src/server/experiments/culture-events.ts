import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type {
  CultureEvent,
  CultureEventRef,
  CultureEventsRequest,
} from "../../domain/experiments/culture-events";
import {
  cultureEventIsTerminal,
  type ObservationOrdinals,
  observationOrdinal,
  observationOrdinals,
  unitIsAvailableAt,
} from "../../domain/experiments/culture-events";
import {
  CultureEventNotFoundError,
  UnitConflictError,
} from "../../domain/experiments/errors";
import type { Unit } from "../../domain/experiments/read-model";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import {
  type Executor,
  inTransaction,
  operationTime,
  single,
} from "../infra/db/client";
import {
  experimentCultureEvents,
  experimentManualReadings,
  experimentObservationImages,
} from "../infra/db/schema";
import {
  listObservations,
  listUnits,
  lockExperiment,
  requireObservation,
  requireUnit,
  toCultureEvent,
} from "./records";

/** Records the same event on several units in one transaction. */
export async function recordCultureEvents(
  value: CultureEventsRequest,
  db?: Executor,
): Promise<CultureEvent[]> {
  return inTransaction(db, async (db) => {
    await lockExperiment(value.experiment, db);
    const observations = await listObservations(value.experiment, db);
    const observation = requireObservation(observations, value.observation);
    const units = await listUnits(value.experiment, db);
    const ordinals = observationOrdinals(observations);
    const at = await operationTime(db);
    const events: CultureEvent[] = [];
    for (const unitId of value.units) {
      const unit = requireUnit(units, unitId);
      if (
        unit.events.some(
          (event) =>
            event.observation === observation.id && event.type === value.type,
        )
      )
        throw new UnitConflictError(
          `${value.type} is already recorded for ${unit.code} at this observation`,
        );
      if (
        cultureEventIsTerminal(value.type) &&
        unit.events.some((event) => cultureEventIsTerminal(event.type))
      )
        throw new UnitConflictError(`${unit.code} has already left the bench`);
      if (!unitIsAvailableAt(unit.events, observation, ordinals))
        throw new UnitConflictError(
          `Unit ${unit.code} was already removed before this observation`,
        );
      if (cultureEventIsTerminal(value.type))
        await assertUnitRecordsEndAt(
          value.experiment,
          unit,
          observation,
          ordinals,
          db,
        );
      const row = single(
        await db
          .insert(experimentCultureEvents)
          .values({
            experimentId: value.experiment,
            id: randomUUID(),
            unitId,
            observationId: observation.id,
            type: value.type,
            recordedAt: at,
          })
          .returning(),
        "experimentCultureEvents",
      );
      events.push(toCultureEvent(row));
    }
    return events;
  });
}

/** Erases an event that was recorded by mistake. */
export async function deleteCultureEvent(
  { experiment: experimentId, event: eventId }: CultureEventRef,
  db?: Executor,
): Promise<void> {
  await inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    const [row] = await db
      .delete(experimentCultureEvents)
      .where(
        and(
          eq(experimentCultureEvents.experimentId, experimentId),
          eq(experimentCultureEvents.id, eventId),
        ),
      )
      .returning({ id: experimentCultureEvents.id });
    if (!row) {
      throw new CultureEventNotFoundError(`Unknown culture event: ${eventId}`);
    }
  });
}

/** A terminal event and every dated record must describe one consistent unit lifetime. */
export async function assertUnitRecordsEndAt(
  experimentId: string,
  unit: Unit,
  observation: ExperimentObservation,
  ordinals: ObservationOrdinals,
  db: Executor,
): Promise<void> {
  const [imageObservations, manualObservations] = await Promise.all([
    db
      .select({ observation: experimentObservationImages.observationId })
      .from(experimentObservationImages)
      .where(
        and(
          eq(experimentObservationImages.experimentId, experimentId),
          eq(experimentObservationImages.unitId, unit.id),
        ),
      ),
    db
      .select({ observation: experimentManualReadings.observationId })
      .from(experimentManualReadings)
      .where(
        and(
          eq(experimentManualReadings.experimentId, experimentId),
          eq(experimentManualReadings.unitId, unit.id),
        ),
      ),
  ]);
  const hasLaterRecord =
    [...imageObservations, ...manualObservations].some(
      (record) =>
        observationOrdinal(ordinals, record.observation) > observation.ordinal,
    ) ||
    unit.events.some(
      (event) =>
        observationOrdinal(ordinals, event.observation) > observation.ordinal,
    );
  if (hasLaterRecord) {
    throw new UnitConflictError(
      `Unit ${unit.code} has records after this observation and cannot be removed here`,
    );
  }
}
