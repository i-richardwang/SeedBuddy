import { randomUUID } from "node:crypto";

import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";

import {
  ExperimentNameTakenError,
  ExperimentRecordsConflictError,
  ObservationConflictError,
  TreatmentConflictError,
  TreatmentNameTakenError,
  TreatmentNotFoundError,
  UnitConflictError,
  UnitNameTakenError,
} from "../../domain/experiments/errors";
import { replicateCodes } from "../../domain/experiments/naming";
import type { Unit } from "../../domain/experiments/read-model";
import type {
  Experiment,
  ExperimentRef,
  ExperimentRequest,
  ExperimentUpdate,
  ReplicateRequest,
  Treatment,
  TreatmentDesign,
  TreatmentRef,
  TreatmentRequest,
  TreatmentUpdate,
  UnitBaselinesUpdate,
  UnitRef,
  UnitsReached,
  UnitsTreatmentUpdate,
  UnitUpdate,
} from "../../domain/experiments/schema";
import {
  type Executor,
  inTransaction,
  operationTime,
  single,
} from "../infra/db/client";
import { refusingUnique } from "../infra/db/errors";
import {
  experimentObservations,
  experiments,
  experimentTreatments,
  experimentUnits,
} from "../infra/db/schema";
import {
  atTreatment,
  atUnit,
  countUnits,
  countUnitsByTreatment,
  hasRecords,
  listObservations,
  listTreatments,
  lockExperiment,
  requireObservation,
  requireTreatment,
  requireUnit,
  requireUnits,
  selectedUnits,
  toExperiment,
  toTreatment,
  toUnit,
  unitRowsIn,
} from "./records";

/** An experiment starts with its design: every treatment laid out in replicates. */
export async function createExperiment(
  value: ExperimentRequest,
  db?: Executor,
): Promise<Experiment> {
  const { treatments, ...page } = value;
  return inTransaction(db, async (db) => {
    const at = await operationTime(db);
    const row = single(
      await refuseTakenName(page.name, () =>
        db
          .insert(experiments)
          .values({ ...page, id: randomUUID(), createdAt: at })
          .returning(),
      ),
      "experiments",
    );
    for (const [index, treatment] of treatments.entries()) {
      await insertTreatment(row.id, treatment, index + 1, db);
    }
    return toExperiment(row);
  });
}

/** Two experiments cannot read the same name, whatever its case. */
async function refuseTakenName<T>(
  name: string,
  write: () => Promise<T>,
): Promise<T> {
  return refusingUnique(
    "experiments_name",
    () =>
      new ExperimentNameTakenError(
        `An experiment named ${name} already exists`,
      ),
    write,
  );
}

export async function updateExperiment(
  value: ExperimentUpdate,
  db?: Executor,
): Promise<Experiment> {
  const { experiment: experimentId, ...page } = value;
  return inTransaction(db, async (db) => {
    const current = await lockExperiment(experimentId, db);
    if (page.inoculatedOn !== current.inoculatedOn) {
      const [early] = await db
        .select({ observedOn: experimentObservations.observedOn })
        .from(experimentObservations)
        .where(
          and(
            eq(experimentObservations.experimentId, experimentId),
            lt(experimentObservations.observedOn, page.inoculatedOn),
          ),
        )
        .limit(1);
      if (early) {
        throw new ObservationConflictError(
          `An observation cannot precede inoculation on ${page.inoculatedOn}`,
        );
      }
    }
    const row = single(
      await refuseTakenName(page.name, () =>
        db
          .update(experiments)
          .set(page)
          .where(eq(experiments.id, experimentId))
          .returning(),
      ),
      "experiments",
    );
    return toExperiment(row);
  });
}

export async function deleteExperiment(
  value: ExperimentRef,
  db?: Executor,
): Promise<void> {
  const { experiment } = value;
  await inTransaction(db, async (db) => {
    await lockExperiment(experiment, db);
    if (await hasRecords(experiment, { units: "all" }, db)) {
      throw new ExperimentRecordsConflictError(
        "An experiment with images, counts or culture events cannot be deleted",
      );
    }
    await db.delete(experiments).where(eq(experiments.id, experiment));
  });
}

async function insertTreatment(
  experimentId: string,
  design: TreatmentDesign,
  position: number,
  db: Executor,
): Promise<Treatment> {
  const { replicates, ...fields } = design;
  const row = single(
    await refusingUnique(
      "experiment_treatments_name",
      () =>
        new TreatmentNameTakenError(`Treatment ${fields.name} already exists`),
      () =>
        db
          .insert(experimentTreatments)
          .values({ experimentId, id: randomUUID(), ...fields, position })
          .returning(),
    ),
    "experimentTreatments",
  );
  const treatment = toTreatment(row);
  await insertReplicates(experimentId, treatment, replicates, db);
  return treatment;
}

/** Lays out `T1-1` through `T1-n`, continuing any series the experiment has. */
async function insertReplicates(
  experimentId: string,
  treatment: Treatment,
  replicates: number,
  db: Executor,
): Promise<Unit[]> {
  const taken = (
    await db
      .select({ code: experimentUnits.code })
      .from(experimentUnits)
      .where(eq(experimentUnits.experimentId, experimentId))
  ).map((row) => row.code);
  const rows = await db
    .insert(experimentUnits)
    .values(
      replicateCodes(treatment.name, replicates, taken).map((code) => ({
        experimentId,
        id: randomUUID(),
        code,
        treatmentId: treatment.id,
      })),
    )
    .returning();
  return rows.map((row) => toUnit(row));
}

export async function addTreatment(
  value: TreatmentRequest,
  db?: Executor,
): Promise<Treatment> {
  const { experiment: experimentId, ...design } = value;
  return inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    const existing = await listTreatments(experimentId, db);
    return insertTreatment(experimentId, design, existing.length + 1, db);
  });
}

export async function addReplicates(
  value: ReplicateRequest,
  db?: Executor,
): Promise<Unit[]> {
  const {
    experiment: experimentId,
    treatment: treatmentId,
    replicates,
  } = value;
  return inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    const treatment = await requireTreatment(experimentId, treatmentId, db);
    return insertReplicates(experimentId, treatment, replicates, db);
  });
}

export async function updateTreatment(
  value: TreatmentUpdate,
  db?: Executor,
): Promise<Treatment> {
  const { experiment: experimentId, treatment: treatmentId, ...design } = value;
  return inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    const [row] = await refusingUnique(
      "experiment_treatments_name",
      () =>
        new TreatmentNameTakenError(`Treatment ${design.name} already exists`),
      () =>
        db
          .update(experimentTreatments)
          .set(design)
          .where(atTreatment(experimentId, treatmentId))
          .returning(),
    );
    if (!row) {
      throw new TreatmentNotFoundError(`Unknown treatment: ${treatmentId}`);
    }
    return toTreatment(row);
  });
}

/**
 * A treatment leaves with its units, which is why recorded ones stay. The
 * last treatment stays too: an experiment keeps a design.
 */
export async function deleteTreatment(
  value: TreatmentRef,
  db?: Executor,
): Promise<void> {
  const { experiment: experimentId, treatment: treatmentId } = value;
  await inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    const [other] = await db
      .select({ id: experimentTreatments.id })
      .from(experimentTreatments)
      .where(
        and(
          eq(experimentTreatments.experimentId, experimentId),
          ne(experimentTreatments.id, treatmentId),
        ),
      )
      .limit(1);
    if (!other) {
      throw new TreatmentConflictError(
        "The last treatment of an experiment cannot be deleted",
      );
    }
    if (
      await hasRecords(experimentId, { units: { treatment: treatmentId } }, db)
    ) {
      throw new TreatmentConflictError(
        "A treatment whose units have images, counts or culture events cannot be deleted",
      );
    }
    const [row] = await db
      .delete(experimentTreatments)
      .where(atTreatment(experimentId, treatmentId))
      .returning({ position: experimentTreatments.position });
    if (!row) {
      throw new TreatmentNotFoundError(`Unknown treatment: ${treatmentId}`);
    }
    await db
      .update(experimentTreatments)
      .set({ position: sql`${experimentTreatments.position} - 1` })
      .where(
        and(
          eq(experimentTreatments.experimentId, experimentId),
          sql`${experimentTreatments.position} > ${row.position}`,
        ),
      );
  });
}

export async function updateUnit(
  value: UnitUpdate,
  db?: Executor,
): Promise<Unit> {
  const { experiment: experimentId, unit: unitId, code, treatment } = value;
  return inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    await requireTreatment(experimentId, treatment, db);
    const unit = await requireUnit(experimentId, unitId, db);
    await keepEveryTreatment(experimentId, [unit], treatment, db);
    const row = single(
      await refusingUnique(
        "experiment_units_code",
        () => new UnitNameTakenError(`The experiment already has ${code}`),
        () =>
          db
            .update(experimentUnits)
            .set({ code, treatmentId: treatment })
            .where(atUnit(experimentId, unitId))
            .returning(),
      ),
      "experimentUnits",
    );
    return toUnit(row, unit.events);
  });
}

/** Moves named units to one treatment in one transaction; each keeps its code. */
export async function moveUnits(
  value: UnitsTreatmentUpdate,
  db?: Executor,
): Promise<Unit[]> {
  const { experiment: experimentId, treatment } = value;
  return inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    await requireTreatment(experimentId, treatment, db);
    const units = await requireUnits(experimentId, value.units, db);
    await keepEveryTreatment(experimentId, units, treatment, db);
    await db
      .update(experimentUnits)
      .set({ treatmentId: treatment })
      .where(
        and(
          eq(experimentUnits.experimentId, experimentId),
          inArray(experimentUnits.id, [...value.units]),
        ),
      );
    return units.map((unit) => ({ ...unit, treatment }));
  });
}

/**
 * Names the observation the selected units' rates are taken against, or
 * none, in one transaction. It reads nothing again; only the rates change.
 */
export async function setUnitBaselines(
  value: UnitBaselinesUpdate,
  db?: Executor,
): Promise<UnitsReached> {
  const { experiment: experimentId, observation } = value;
  return inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    if (observation !== null) {
      requireObservation(await listObservations(experimentId, db), observation);
    }
    const { units, scope } = await selectedUnits(experimentId, value.units, db);
    await db
      .update(experimentUnits)
      .set({ baselineObservationId: observation })
      .where(unitRowsIn(experimentId, scope));
    return { units: units.length };
  });
}

/** A recorded unit stays, and so does the last replicate of its treatment. */
export async function deleteUnit(value: UnitRef, db?: Executor): Promise<void> {
  const { experiment: experimentId, unit: unitId } = value;
  await inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    const unit = await requireUnit(experimentId, unitId, db);
    const refusal = await unitDeletionRefusal(experimentId, unit, db);
    if (refusal) throw new UnitConflictError(refusal);
    await db.delete(experimentUnits).where(atUnit(experimentId, unitId));
  });
}

/**
 * Why the unit cannot be deleted, or null where it can: its treatment keeps
 * a replicate, and nothing is recorded of it.
 */
export async function unitDeletionRefusal(
  experimentId: string,
  unit: Unit,
  db: Executor,
): Promise<string | null> {
  if ((await countUnits(experimentId, db, { treatment: unit.treatment })) < 2) {
    return "The last replicate of a treatment cannot be deleted";
  }
  if (await hasRecords(experimentId, { units: { units: [unit.id] } }, db)) {
    return "A unit with images, counts or culture events cannot be deleted";
  }
  return null;
}

/**
 * Every treatment keeps a replicate: refuses moving `leaving` to the
 * treatment `to` where that would leave a treatment they come from without
 * units.
 */
async function keepEveryTreatment(
  experimentId: string,
  leaving: readonly Unit[],
  to: string,
  db: Executor,
): Promise<void> {
  const remaining = await countUnitsByTreatment(experimentId, db);
  for (const unit of leaving) {
    if (unit.treatment === to) continue;
    remaining.set(unit.treatment, (remaining.get(unit.treatment) ?? 0) - 1);
  }
  if (leaving.some((unit) => (remaining.get(unit.treatment) ?? 0) < 1)) {
    throw new UnitConflictError(
      "The last replicate of a treatment cannot be moved",
    );
  }
}
