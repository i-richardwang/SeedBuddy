/** Reads experiment records and enforces record existence within a transaction. */
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  type CultureEvent,
  cultureEventSchema,
} from "../../domain/experiments/culture-events";
import {
  ExperimentNotFoundError,
  ObservationNotFoundError,
  UnitNotFoundError,
} from "../../domain/experiments/errors";
import type { Unit } from "../../domain/experiments/read-model";
import {
  type Experiment,
  type ExperimentObservation,
  experimentObservationSchema,
  experimentSchema,
  type ManualReading,
  manualReadingSchema,
  type Treatment,
  treatmentSchema,
} from "../../domain/experiments/schema";
import type { Executor } from "../infra/db/client";
import {
  experimentCultureEvents,
  experimentManualReadings,
  experimentObservationImages,
  experimentObservations,
  experiments,
  experimentTreatments,
  experimentUnits,
} from "../infra/db/schema";

export function toExperiment(row: typeof experiments.$inferSelect): Experiment {
  return experimentSchema.parse({
    id: row.id,
    name: row.name,
    plantMaterial: row.plantMaterial,
    explantType: row.explantType,
    baseMedium: row.baseMedium,
    notes: row.notes,
    inoculatedOn: row.inoculatedOn,
    countsUnclear: row.countsUnclear,
    createdAt: row.createdAt.toISOString(),
  });
}

export function toTreatment(
  row: typeof experimentTreatments.$inferSelect,
): Treatment {
  return treatmentSchema.parse({
    id: row.id,
    name: row.name,
    factor: row.factor ?? null,
    note: row.note,
    position: row.position,
  });
}

export function toUnit(
  row: typeof experimentUnits.$inferSelect,
  events: CultureEvent[] = [],
): Unit {
  return {
    id: row.id,
    code: row.code,
    treatment: row.treatmentId,
    events,
  };
}

export function toCultureEvent(
  row: typeof experimentCultureEvents.$inferSelect,
): CultureEvent {
  return cultureEventSchema.parse({
    id: row.id,
    type: row.type,
    observation: row.observationId,
    recordedAt: row.recordedAt.toISOString(),
  });
}

function toObservation(
  row: typeof experimentObservations.$inferSelect,
  ordinal: number,
  hasRecords: boolean,
): ExperimentObservation {
  return experimentObservationSchema.parse({
    id: row.id,
    ordinal,
    observedOn: row.observedOn,
    note: row.note,
    modelId: row.modelId,
    countedClasses: row.countedClasses,
    hasRecords,
  });
}

export async function readExperimentRecord(
  experimentId: string,
  db: Executor,
): Promise<Experiment | null> {
  const [row] = await db
    .select()
    .from(experiments)
    .where(eq(experiments.id, experimentId));
  return row ? toExperiment(row) : null;
}

export async function lockExperiment(
  experimentId: string,
  tx: Executor,
): Promise<Experiment> {
  const [locked] = await tx
    .select()
    .from(experiments)
    .where(eq(experiments.id, experimentId))
    .for("update");
  if (!locked) {
    throw new ExperimentNotFoundError(`Unknown experiment: ${experimentId}`);
  }
  return toExperiment(locked);
}

export async function listTreatments(
  experimentId: string,
  db: Executor,
): Promise<Treatment[]> {
  const rows = await db
    .select()
    .from(experimentTreatments)
    .where(eq(experimentTreatments.experimentId, experimentId))
    .orderBy(asc(experimentTreatments.position));
  return rows.map(toTreatment);
}

export function atTreatment(experimentId: string, treatmentId: string) {
  return and(
    eq(experimentTreatments.experimentId, experimentId),
    eq(experimentTreatments.id, treatmentId),
  );
}

export function atUnit(experimentId: string, unitId: string) {
  return and(
    eq(experimentUnits.experimentId, experimentId),
    eq(experimentUnits.id, unitId),
  );
}

export function atObservation(experimentId: string, observationId: string) {
  return and(
    eq(experimentObservations.experimentId, experimentId),
    eq(experimentObservations.id, observationId),
  );
}

export async function listUnits(
  experimentId: string,
  db: Executor,
): Promise<Unit[]> {
  const [rows, eventRows] = await Promise.all([
    db
      .select()
      .from(experimentUnits)
      .where(eq(experimentUnits.experimentId, experimentId))
      .orderBy(asc(experimentUnits.code)),
    db
      .select()
      .from(experimentCultureEvents)
      .where(eq(experimentCultureEvents.experimentId, experimentId))
      .orderBy(
        asc(experimentCultureEvents.recordedAt),
        asc(experimentCultureEvents.id),
      ),
  ]);
  const byUnit = new Map<string, CultureEvent[]>();
  for (const row of eventRows) {
    const events = byUnit.get(row.unitId) ?? [];
    events.push(toCultureEvent(row));
    byUnit.set(row.unitId, events);
  }
  return rows.map((row) => toUnit(row, byUnit.get(row.id) ?? []));
}

function toManualReading(
  row: typeof experimentManualReadings.$inferSelect,
): ManualReading {
  return manualReadingSchema.parse({
    unit: row.unitId,
    observation: row.observationId,
    tally: row.tally,
    recordedAt: row.recordedAt.toISOString(),
  });
}

/** The counts people entered by hand across the experiment. */
export async function listManualReadings(
  experimentId: string,
  db: Executor,
): Promise<ManualReading[]> {
  const rows = await db
    .select()
    .from(experimentManualReadings)
    .where(eq(experimentManualReadings.experimentId, experimentId))
    .orderBy(
      asc(experimentManualReadings.observationId),
      asc(experimentManualReadings.unitId),
    );
  return rows.map(toManualReading);
}

/**
 * An observation has records once anything was recorded on it: a photograph
 * placed, a count entered, or a culture event.
 */
export async function listObservations(
  experimentId: string,
  db: Executor,
): Promise<ExperimentObservation[]> {
  const [rows, observationImageRefs, manualRefs, eventRefs] = await Promise.all(
    [
      db
        .select()
        .from(experimentObservations)
        .where(eq(experimentObservations.experimentId, experimentId))
        .orderBy(asc(experimentObservations.observedOn)),
      db
        .select({ observation: experimentObservationImages.observationId })
        .from(experimentObservationImages)
        .where(eq(experimentObservationImages.experimentId, experimentId)),
      db
        .select({ observation: experimentManualReadings.observationId })
        .from(experimentManualReadings)
        .where(eq(experimentManualReadings.experimentId, experimentId)),
      db
        .select({ observation: experimentCultureEvents.observationId })
        .from(experimentCultureEvents)
        .where(eq(experimentCultureEvents.experimentId, experimentId)),
    ],
  );
  const recorded = new Set([
    ...observationImageRefs.map((row) => row.observation),
    ...manualRefs.map((row) => row.observation),
    ...eventRefs.map((row) => row.observation),
  ]);
  return rows.map((observation, index) =>
    toObservation(observation, index + 1, recorded.has(observation.id)),
  );
}

export function requireObservation(
  observations: ExperimentObservation[],
  observationId: string,
): ExperimentObservation {
  const observation = observations.find((item) => item.id === observationId);
  if (!observation) {
    throw new ObservationNotFoundError(`Unknown observation: ${observationId}`);
  }
  return observation;
}

export function atObservationImage(
  experimentId: string,
  observationImageId: string,
) {
  return and(
    eq(experimentObservationImages.experimentId, experimentId),
    eq(experimentObservationImages.id, observationImageId),
  );
}

type RecordScope = { treatment: string } | { unit: string } | null;

/**
 * Whether images, counts or culture events were recorded: on the whole experiment,
 * on one treatment's units, or on one unit.
 */
export async function hasRecords(
  experimentId: string,
  scope: RecordScope,
  tx: Executor,
): Promise<boolean> {
  const inScope = (
    unitId:
      | typeof experimentObservationImages.unitId
      | typeof experimentManualReadings.unitId
      | typeof experimentCultureEvents.unitId,
  ) => {
    if (scope === null) return undefined;
    if ("unit" in scope) return eq(unitId, scope.unit);
    return inArray(
      unitId,
      tx
        .select({ id: experimentUnits.id })
        .from(experimentUnits)
        .where(
          and(
            eq(experimentUnits.experimentId, experimentId),
            eq(experimentUnits.treatmentId, scope.treatment),
          ),
        ),
    );
  };
  const [image] = await tx
    .select({ id: experimentObservationImages.id })
    .from(experimentObservationImages)
    .where(
      and(
        eq(experimentObservationImages.experimentId, experimentId),
        inScope(experimentObservationImages.unitId),
      ),
    )
    .limit(1);
  if (image) return true;
  const [manual] = await tx
    .select({ unitId: experimentManualReadings.unitId })
    .from(experimentManualReadings)
    .where(
      and(
        eq(experimentManualReadings.experimentId, experimentId),
        inScope(experimentManualReadings.unitId),
      ),
    )
    .limit(1);
  if (manual) return true;
  const [event] = await tx
    .select({ id: experimentCultureEvents.id })
    .from(experimentCultureEvents)
    .where(
      and(
        eq(experimentCultureEvents.experimentId, experimentId),
        inScope(experimentCultureEvents.unitId),
      ),
    )
    .limit(1);
  return event !== undefined;
}

export function requireUnit(units: readonly Unit[], unitId: string): Unit {
  const unit = units.find((item) => item.id === unitId);
  if (!unit) throw new UnitNotFoundError(`Unknown unit: ${unitId}`);
  return unit;
}

/** The observation an image was taken at. */
export function atImageObservation() {
  return and(
    eq(
      experimentObservations.experimentId,
      experimentObservationImages.experimentId,
    ),
    eq(experimentObservations.id, experimentObservationImages.observationId),
  );
}
