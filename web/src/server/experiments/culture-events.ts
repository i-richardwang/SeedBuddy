import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { inTransaction, type Executor } from "../infra/db/client";
import {
  experimentCultureEvents,
  experimentManualReadings,
  experimentObservationImages,
} from "../infra/db/schema";
import {
  cultureEventIsTerminal,
  observationOrdinal,
  observationOrdinals,
  unitIsAvailableAt,
} from "../../domain/experiments/culture-events";
import {
  CultureEventNotFoundError,
  ObservationNotFoundError,
  UnitNotFoundError,
  UnitRejectedError,
} from "../../domain/experiments/errors";
import type {
  CultureEvent,
  CultureEventRef,
  CultureEventRequest,
  CultureEventsRequest,
} from "../../domain/experiments/schema";
import { listObservations, listUnits, lockExperiment } from "./records";

export async function recordCultureEvent(
  value: CultureEventRequest,
  executor?: Executor,
): Promise<CultureEvent> {
  const {
    experiment: experimentId,
    unit: unitId,
    observation: observationId,
    type,
  } = value;
  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const observations = await listObservations(experimentId, tx);
    const observation = observations.find((item) => item.id === observationId);
    if (!observation) {
      throw new ObservationNotFoundError(
        `Unknown observation: ${observationId}`,
      );
    }
    const unit = (await listUnits(experimentId, tx)).find(
      (item) => item.id === unitId,
    );
    if (!unit) throw new UnitNotFoundError(`Unknown unit: ${unitId}`);
    if (
      unit.events.some(
        (event) => event.observation === observationId && event.type === type,
      )
    ) {
      throw new UnitRejectedError(
        `${type} is already recorded for ${unit.code} at this observation`,
      );
    }
    const hasTerminalEvent = unit.events.some((event) =>
      cultureEventIsTerminal(event.type),
    );
    if (cultureEventIsTerminal(type) && hasTerminalEvent) {
      throw new UnitRejectedError(`${unit.code} has already left the bench`);
    }

    const ordinals = observationOrdinals(observations);
    if (!unitIsAvailableAt(unit.events, observation, ordinals)) {
      throw new UnitRejectedError(
        `Unit ${unit.code} was already removed before this observation`,
      );
    }
    if (cultureEventIsTerminal(type)) {
      const [imageObservations, manualObservations] = await Promise.all([
        tx
          .select({ observation: experimentObservationImages.observationId })
          .from(experimentObservationImages)
          .where(
            and(
              eq(experimentObservationImages.experimentId, experimentId),
              eq(experimentObservationImages.unitId, unitId),
            ),
          ),
        tx
          .select({ observation: experimentManualReadings.observationId })
          .from(experimentManualReadings)
          .where(
            and(
              eq(experimentManualReadings.experimentId, experimentId),
              eq(experimentManualReadings.unitId, unitId),
            ),
          ),
      ]);
      const hasLaterRecord =
        [...imageObservations, ...manualObservations].some(
          (record) =>
            observationOrdinal(ordinals, record.observation) >
            observation.ordinal,
        ) ||
        unit.events.some(
          (event) =>
            observationOrdinal(ordinals, event.observation) >
            observation.ordinal,
        );
      if (hasLaterRecord) {
        throw new UnitRejectedError(
          `Unit ${unit.code} has records after this observation and cannot be removed here`,
        );
      }
    }

    const [row] = await tx
      .insert(experimentCultureEvents)
      .values({
        experimentId,
        id: randomUUID(),
        unitId,
        observationId,
        type,
        recordedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Culture event was not recorded");
    const updated = (await listUnits(experimentId, tx)).find(
      (item) => item.id === unitId,
    );
    const event = updated?.events.find((item) => item.id === row.id);
    if (!event) throw new Error("Culture event was not read back");
    return event;
  });
}

/** Records the same event on several units in one transaction. */
export async function recordCultureEvents(
  value: CultureEventsRequest,
  executor?: Executor,
): Promise<CultureEvent[]> {
  return inTransaction(executor, async (tx) => {
    const events: CultureEvent[] = [];
    for (const unit of value.units) {
      events.push(
        await recordCultureEvent(
          {
            experiment: value.experiment,
            unit,
            type: value.type,
            observation: value.observation,
          },
          tx,
        ),
      );
    }
    return events;
  });
}

/** Erases an event that was recorded by mistake. */
export async function deleteCultureEvent(
  { experiment: experimentId, event: eventId }: CultureEventRef,
  executor?: Executor,
): Promise<void> {
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const [row] = await tx
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
