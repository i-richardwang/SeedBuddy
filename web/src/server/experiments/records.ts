/** Reads experiment records and enforces record existence within a transaction. */
import {
  and,
  asc,
  count,
  eq,
  exists,
  inArray,
  type SQL,
  sql,
} from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";

import {
  type CultureEvent,
  cultureEventSchema,
  TERMINAL_CULTURE_EVENT_TYPES,
} from "../../domain/experiments/culture-events";
import {
  ExperimentNotFoundError,
  ObservationNotFoundError,
  TreatmentNotFoundError,
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
  db: Executor,
): Promise<Experiment> {
  const [locked] = await db
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

/**
 * Which units a read covers: every unit of the experiment, those of one
 * treatment, or those named.
 */
export type UnitScope =
  "all" | { treatment: string } | { units: readonly string[] };

/** Which records a read covers: those of the units in scope, on every observation or on one. */
export interface RecordScope {
  units: UnitScope;
  observation?: string;
}

/**
 * The units in scope, as a condition on a column naming a unit of the
 * experiment: the units named, or those `unitRowsIn` finds.
 */
function unitsIn(
  experimentId: string,
  column: AnyPgColumn,
  scope: UnitScope,
): SQL | undefined {
  if (scope === "all") return undefined;
  if ("units" in scope) return inArray(column, [...scope.units]);
  return sql`${column} in (select ${experimentUnits.id} from ${experimentUnits} where ${unitRowsIn(experimentId, scope)})`;
}

/** A table that records units' days: their photographs, counts or culture events. */
export type UnitDayTable =
  | typeof experimentObservationImages
  | typeof experimentManualReadings
  | typeof experimentCultureEvents;

/** The records in scope of a table that records units' days. */
export function recordsIn(
  table: UnitDayTable,
  experimentId: string,
  scope: RecordScope,
): SQL | undefined {
  return and(
    eq(table.experimentId, experimentId),
    unitsIn(experimentId, table.unitId, scope.units),
    scope.observation === undefined
      ? undefined
      : eq(table.observationId, scope.observation),
  );
}

/** The experiment's units in scope, as a condition on the units' table. */
function unitRowsIn(experimentId: string, scope: UnitScope): SQL | undefined {
  return and(
    eq(experimentUnits.experimentId, experimentId),
    scope === "all"
      ? undefined
      : "units" in scope
        ? inArray(experimentUnits.id, [...scope.units])
        : eq(experimentUnits.treatmentId, scope.treatment),
  );
}

/** A unit's treatment, joined to order the unit by. */
export function atUnitTreatment() {
  return and(
    eq(experimentTreatments.experimentId, experimentUnits.experimentId),
    eq(experimentTreatments.id, experimentUnits.treatmentId),
  );
}

/**
 * The experiment's order of units, over units joined to their treatments
 * (`atUnitTreatment`): its treatments in their order, and each treatment's
 * units by code, numbers compared by value. Codes that differ only in how a
 * number is written, `T1-1` and `T1-01`, compare equal, so their order falls
 * to the unit's id: the order is total, and a page never repeats or drops a
 * unit.
 */
export const UNIT_ORDER = [
  asc(experimentTreatments.position),
  sql`${experimentUnits.codeOrder} collate "C"`,
  asc(experimentUnits.id),
];

/** A run of units in the experiment's order: `limit` of them, after the first `offset`. */
export interface UnitWindow {
  offset: number;
  limit: number;
}

/**
 * The units a read returned, as the scope of their records: the scope it
 * read, or, where a window cut a run from it, the units of that run.
 */
export function scopeOfRead(
  scope: UnitScope,
  window: UnitWindow | undefined,
  units: readonly { id: string }[],
): UnitScope {
  return window ? { units: units.map((unit) => unit.id) } : scope;
}

/**
 * The experiment's units in scope, in the experiment's order, each with its
 * culture events; with `window`, only the run of them it names.
 */
export async function listUnits(
  experimentId: string,
  db: Executor,
  scope: UnitScope = "all",
  window?: UnitWindow,
): Promise<Unit[]> {
  const query = db
    .select({ unit: experimentUnits })
    .from(experimentUnits)
    .innerJoin(experimentTreatments, atUnitTreatment())
    .where(unitRowsIn(experimentId, scope))
    .orderBy(...UNIT_ORDER)
    .$dynamic();
  const rows = (
    window ? await query.offset(window.offset).limit(window.limit) : await query
  ).map((row) => row.unit);
  if (rows.length === 0) return [];
  const eventRows = await db
    .select()
    .from(experimentCultureEvents)
    .where(
      recordsIn(experimentCultureEvents, experimentId, {
        units: scopeOfRead(scope, window, rows),
      }),
    )
    .orderBy(
      asc(experimentCultureEvents.recordedAt),
      asc(experimentCultureEvents.id),
    );
  const byUnit = new Map<string, CultureEvent[]>();
  for (const row of eventRows) {
    const events = byUnit.get(row.unitId) ?? [];
    events.push(toCultureEvent(row));
    byUnit.set(row.unitId, events);
  }
  return rows.map((row) => toUnit(row, byUnit.get(row.id) ?? []));
}

/** How many of the experiment's units are in scope. */
export async function countUnits(
  experimentId: string,
  db: Executor,
  scope: UnitScope = "all",
): Promise<number> {
  const [row] = await db
    .select({ units: count() })
    .from(experimentUnits)
    .where(unitRowsIn(experimentId, scope));
  return row!.units;
}

/** How many units each treatment of the experiment holds; a treatment without any is absent. */
export async function countUnitsByTreatment(
  experimentId: string,
  db: Executor,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ treatment: experimentUnits.treatmentId, units: count() })
    .from(experimentUnits)
    .where(eq(experimentUnits.experimentId, experimentId))
    .groupBy(experimentUnits.treatmentId);
  return new Map(rows.map((row) => [row.treatment, row.units]));
}

/**
 * The day each unit that left the bench left it, as a subquery: the day of
 * the observation recording its terminal event, of which a unit has one at
 * most. A unit on the bench is absent. The domain reads the same day from a
 * unit's events (`unitLeftOn`).
 */
export function benchExits(experimentId: string, db: Executor) {
  const observation = alias(experimentObservations, "exit_observation");
  return db
    .select({
      unit: sql<string>`${experimentCultureEvents.unitId}`.as("unit"),
      leftOn: sql<string>`${observation.observedOn}`.as("left_on"),
    })
    .from(experimentCultureEvents)
    .innerJoin(
      observation,
      and(
        eq(observation.experimentId, experimentCultureEvents.experimentId),
        eq(observation.id, experimentCultureEvents.observationId),
      ),
    )
    .where(
      and(
        eq(experimentCultureEvents.experimentId, experimentId),
        inArray(experimentCultureEvents.type, [
          ...TERMINAL_CULTURE_EVENT_TYPES,
        ]),
      ),
    )
    .as("bench_exit");
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

/** The counts people entered by hand for the records in scope. */
export async function listManualReadings(
  experimentId: string,
  db: Executor,
  scope: RecordScope = { units: "all" },
): Promise<ManualReading[]> {
  const rows = await db
    .select()
    .from(experimentManualReadings)
    .where(recordsIn(experimentManualReadings, experimentId, scope))
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
  const observation = alias(experimentObservations, "observation");
  const recordedOn = (table: UnitDayTable) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(table)
        .where(
          and(
            eq(table.experimentId, observation.experimentId),
            eq(table.observationId, observation.id),
          ),
        ),
    );
  const rows = await db
    .select({
      observation,
      hasRecords: sql<boolean>`${recordedOn(experimentObservationImages)} or ${recordedOn(experimentManualReadings)} or ${recordedOn(experimentCultureEvents)}`,
    })
    .from(observation)
    .where(eq(observation.experimentId, experimentId))
    .orderBy(asc(observation.observedOn));
  return rows.map((row, index) =>
    toObservation(row.observation, index + 1, row.hasRecords),
  );
}

export function requireObservation(
  observations: readonly ExperimentObservation[],
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

/**
 * Whether any of `tables` holds a record in scope; by default, whether
 * images, counts or culture events were recorded for the units in scope.
 */
export async function hasRecords(
  experimentId: string,
  scope: RecordScope,
  db: Executor,
  tables: readonly UnitDayTable[] = [
    experimentObservationImages,
    experimentManualReadings,
    experimentCultureEvents,
  ],
): Promise<boolean> {
  for (const table of tables) {
    const [found] = await db
      .select({ one: sql`1` })
      .from(table)
      .where(recordsIn(table, experimentId, scope))
      .limit(1);
    if (found) return true;
  }
  return false;
}

export async function requireTreatment(
  experimentId: string,
  treatmentId: string,
  db: Executor,
): Promise<Treatment> {
  const [treatment] = await db
    .select()
    .from(experimentTreatments)
    .where(atTreatment(experimentId, treatmentId));
  if (!treatment) {
    throw new TreatmentNotFoundError(`Unknown treatment: ${treatmentId}`);
  }
  return toTreatment(treatment);
}

/** The unit named, which must be the experiment's. */
export async function requireUnit(
  experimentId: string,
  unitId: string,
  db: Executor,
): Promise<Unit> {
  const [unit] = await listUnits(experimentId, db, { units: [unitId] });
  if (!unit) throw new UnitNotFoundError(`Unknown unit: ${unitId}`);
  return unit;
}

/** The units named, in the experiment's order; each must be the experiment's. */
export async function requireUnits(
  experimentId: string,
  unitIds: readonly string[],
  db: Executor,
): Promise<Unit[]> {
  const units = await listUnits(experimentId, db, { units: unitIds });
  const found = new Set(units.map((unit) => unit.id));
  const unknown = unitIds.filter((id) => !found.has(id));
  if (unknown.length > 0) {
    throw new UnitNotFoundError(`Unknown units: ${unknown.join(", ")}`);
  }
  return units;
}

/** The unit an image shows. */
export function atImageUnit() {
  return and(
    eq(experimentUnits.experimentId, experimentObservationImages.experimentId),
    eq(experimentUnits.id, experimentObservationImages.unitId),
  );
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
