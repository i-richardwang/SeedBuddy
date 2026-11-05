import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import type {
  CultureEventRef,
  CultureEventRefusal,
  CultureEventsRequest,
  CultureEventsResult,
} from "../../domain/experiments/culture-events";
import {
  cultureEventIsTerminal,
  cultureEventRefusal,
  hasRecordsAfter,
} from "../../domain/experiments/culture-events";
import {
  CultureEventNotFoundError,
  UnitConflictError,
  UnitSelectionConflictError,
} from "../../domain/experiments/errors";
import type { Unit } from "../../domain/experiments/read-model";
import type {
  ExperimentObservation,
  UnitSelection,
} from "../../domain/experiments/schema";
import {
  type Executor,
  inTransaction,
  operationTime,
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
  type RecordScope,
  recordsIn,
  requireObservation,
  requireTreatment,
  requireUnits,
  toCultureEvent,
  type UnitScope,
} from "./records";

/**
 * Records one event on several units in one transaction. Units named one by
 * one must each take it; of a treatment's units, or the experiment's, those
 * that cannot are passed over, once the selection is found to cover as many
 * units as it was made over.
 */
export async function recordCultureEvents(
  value: CultureEventsRequest,
  db?: Executor,
): Promise<CultureEventsResult> {
  return inTransaction(db, async (db) => {
    const experimentId = value.experiment;
    await lockExperiment(experimentId, db);
    const observations = await listObservations(experimentId, db);
    const observation = requireObservation(observations, value.observation);
    const named = Array.isArray(value.units);
    const { units, scope } = await selectedUnits(experimentId, value.units, db);
    // Leaving the bench is refused where records follow it, so only the
    // later observations' records are read.
    const recordedOn = cultureEventIsTerminal(value.type)
      ? await recordedDays(
          experimentId,
          scope,
          db,
          observations
            .filter((day) => day.ordinal > observation.ordinal)
            .map((day) => day.id),
        )
      : new Map<string, string[]>();
    const refusals = units.flatMap((unit) => {
      const reason = cultureEventRefusal(
        { events: unit.events, recorded: recordedOn.get(unit.id) ?? [] },
        observations,
        observation,
        value.type,
      );
      return reason ? [{ unit: unit.id, code: unit.code, reason }] : [];
    });
    if (named && refusals.length > 0) {
      throw new UnitConflictError(
        refusals
          .map(({ code, reason }) => `${code}: ${REFUSAL_MESSAGES[reason]}`)
          .join("; "),
      );
    }
    const refused = new Set(refusals.map((refusal) => refusal.unit));
    const taking = units.filter((unit) => !refused.has(unit.id));
    const at = await operationTime(db);
    const rows =
      taking.length === 0
        ? []
        : await db
            .insert(experimentCultureEvents)
            .values(
              taking.map((unit) => ({
                experimentId,
                id: randomUUID(),
                unitId: unit.id,
                observationId: observation.id,
                type: value.type,
                recordedAt: at,
              })),
            )
            .returning();
    return {
      recorded: rows.map((row) => ({
        unit: row.unitId,
        event: toCultureEvent(row),
      })),
      passedOver: refusals,
    };
  });
}

const REFUSAL_MESSAGES: Record<CultureEventRefusal, string> = {
  recorded: "the event is already recorded at this observation",
  already_left: "the unit has already left the bench",
  left_before: "the unit left the bench before this observation",
  later_records:
    "the unit has records after this observation and cannot leave the bench here",
};

/**
 * The units a selection names, with their scope: each one named, which must
 * be the experiment's, or the units of the treatment or experiment selected,
 * which must number what the selection was made over.
 */
async function selectedUnits(
  experimentId: string,
  selection: UnitSelection,
  db: Executor,
): Promise<{ units: Unit[]; scope: UnitScope }> {
  if (Array.isArray(selection)) {
    const units = await requireUnits(experimentId, selection, db);
    return { units, scope: { units: selection } };
  }
  const { treatment, expected } = selection;
  if (treatment !== null) await requireTreatment(experimentId, treatment, db);
  const scope: UnitScope = treatment === null ? "all" : { treatment };
  const units = await listUnits(experimentId, db, scope);
  if (units.length !== expected) {
    throw new UnitSelectionConflictError(
      `The selection was made over ${expected} units and now covers ${units.length}`,
    );
  }
  return { units, scope };
}

/**
 * The observations each unit in scope has a photograph or an entered count
 * on, of those named in `among` where it is given.
 */
async function recordedDays(
  experimentId: string,
  units: UnitScope,
  db: Executor,
  among?: readonly string[],
): Promise<Map<string, string[]>> {
  if (among?.length === 0) return new Map();
  const scope: RecordScope = { units };
  const recordsOf = (
    table: typeof experimentObservationImages | typeof experimentManualReadings,
  ) =>
    db
      .select({ unit: table.unitId, observation: table.observationId })
      .from(table)
      .where(
        and(
          recordsIn(table, experimentId, scope),
          among && inArray(table.observationId, [...among]),
        ),
      );
  const rows = await recordsOf(experimentObservationImages).unionAll(
    recordsOf(experimentManualReadings),
  );
  const days = new Map<string, string[]>();
  for (const { unit, observation } of rows) {
    const unitDays = days.get(unit);
    if (unitDays) unitDays.push(observation);
    else days.set(unit, [observation]);
  }
  return days;
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

/**
 * A unit's records end on the day it left the bench: refuses where one of
 * `units` that left has a photograph, a count or an event of a later day.
 */
export async function assertRecordsEndOffBench(
  experimentId: string,
  units: readonly Unit[],
  observations: readonly ExperimentObservation[],
  db: Executor,
): Promise<void> {
  const recordedOn = await recordedDays(
    experimentId,
    { units: units.map((unit) => unit.id) },
    db,
  );
  for (const unit of units) {
    const terminal = unit.events.find((event) =>
      cultureEventIsTerminal(event.type),
    );
    if (
      terminal &&
      hasRecordsAfter(
        { events: unit.events, recorded: recordedOn.get(unit.id) ?? [] },
        observations,
        requireObservation(observations, terminal.observation),
      )
    ) {
      throw new UnitConflictError(
        `${unit.code}: ${REFUSAL_MESSAGES.later_records}`,
      );
    }
  }
}
