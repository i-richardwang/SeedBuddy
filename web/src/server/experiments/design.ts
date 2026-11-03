import { randomUUID } from "node:crypto";

import { and, eq, lt, ne, sql } from "drizzle-orm";

import {
  ExperimentNameTakenError,
  ExperimentNotFoundError,
  ExperimentRecordsConflictError,
  ObservationConflictError,
  TreatmentConflictError,
  TreatmentNameTakenError,
  TreatmentNotFoundError,
  UnitConflictError,
  UnitNameTakenError,
  UnitNotFoundError,
} from "../../domain/experiments/errors";
import { replicateCodes, sameName } from "../../domain/experiments/naming";
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
  UnitRef,
  UnitsTreatmentUpdate,
  UnitUpdate,
} from "../../domain/experiments/schema";
import { type Executor, inTransaction } from "../infra/db/client";
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
  hasRecords,
  listTreatments,
  listUnits,
  lockExperiment,
  toExperiment,
  toTreatment,
  toUnit,
} from "./records";

/** An experiment starts with its design: every treatment laid out in replicates. */
export async function createExperiment(
  value: ExperimentRequest,
  executor?: Executor,
): Promise<Experiment> {
  const { treatments, ...page } = value;
  return inTransaction(executor, async (tx) => {
    const [row] = await refuseTakenName(page.name, () =>
      tx
        .insert(experiments)
        .values({ ...page, id: randomUUID(), createdAt: new Date() })
        .returning(),
    );
    if (!row) throw new Error("Experiment was not created");
    for (const [index, treatment] of treatments.entries()) {
      await insertTreatment(row.id, treatment, index + 1, [], tx);
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
  executor?: Executor,
): Promise<Experiment> {
  const { experiment: experimentId, ...page } = value;
  return inTransaction(executor, async (tx) => {
    const current = await lockExperiment(experimentId, tx);
    if (page.inoculatedOn !== current.inoculatedOn) {
      const [early] = await tx
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
    const [row] = await refuseTakenName(page.name, () =>
      tx
        .update(experiments)
        .set(page)
        .where(eq(experiments.id, experimentId))
        .returning(),
    );
    if (!row) {
      throw new ExperimentNotFoundError(`Unknown experiment: ${experimentId}`);
    }
    return toExperiment(row);
  });
}

export async function deleteExperiment(
  value: ExperimentRef,
  executor?: Executor,
): Promise<void> {
  const { experiment } = value;
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experiment, tx);
    if (await hasRecords(experiment, null, tx)) {
      throw new ExperimentRecordsConflictError(
        "An experiment with images, counts or culture events cannot be deleted",
      );
    }
    const [row] = await tx
      .delete(experiments)
      .where(eq(experiments.id, experiment))
      .returning({ id: experiments.id });
    if (!row) {
      throw new ExperimentNotFoundError(`Unknown experiment: ${experiment}`);
    }
  });
}

async function insertTreatment(
  experimentId: string,
  design: TreatmentDesign,
  position: number,
  existing: readonly Treatment[],
  tx: Executor,
): Promise<Treatment> {
  const { replicates, ...fields } = design;
  if (existing.some((treatment) => sameName(treatment.name, fields.name))) {
    throw new TreatmentNameTakenError(
      `Treatment ${fields.name} already exists`,
    );
  }
  const [row] = await tx
    .insert(experimentTreatments)
    .values({ experimentId, id: randomUUID(), ...fields, position })
    .returning();
  if (!row) throw new Error("Treatment was not created");
  const treatment = toTreatment(row);
  await insertReplicates(experimentId, treatment, replicates, tx);
  return treatment;
}

/** Lays out `T1-1` through `T1-n`, continuing any series the experiment has. */
async function insertReplicates(
  experimentId: string,
  treatment: Treatment,
  replicates: number,
  tx: Executor,
): Promise<Unit[]> {
  const taken = (await listUnits(experimentId, tx)).map((unit) => unit.code);
  const rows = await tx
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
  executor?: Executor,
): Promise<Treatment> {
  const { experiment: experimentId, ...design } = value;
  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const existing = await listTreatments(experimentId, tx);
    return insertTreatment(
      experimentId,
      design,
      existing.length + 1,
      existing,
      tx,
    );
  });
}

export async function addReplicates(
  value: ReplicateRequest,
  executor?: Executor,
): Promise<Unit[]> {
  const {
    experiment: experimentId,
    treatment: treatmentId,
    replicates,
  } = value;
  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const treatment = await requireTreatment(experimentId, treatmentId, tx);
    return insertReplicates(experimentId, treatment, replicates, tx);
  });
}

export async function updateTreatment(
  value: TreatmentUpdate,
  executor?: Executor,
): Promise<Treatment> {
  const { experiment: experimentId, treatment: treatmentId, ...design } = value;
  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const taken = (await listTreatments(experimentId, tx)).find(
      (treatment) =>
        sameName(treatment.name, design.name) && treatment.id !== treatmentId,
    );
    if (taken) {
      throw new TreatmentNameTakenError(
        `Treatment ${design.name} already exists`,
      );
    }
    const [row] = await tx
      .update(experimentTreatments)
      .set(design)
      .where(atTreatment(experimentId, treatmentId))
      .returning();
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
  executor?: Executor,
): Promise<void> {
  const { experiment: experimentId, treatment: treatmentId } = value;
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const [other] = await tx
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
    if (await hasRecords(experimentId, { treatment: treatmentId }, tx)) {
      throw new TreatmentConflictError(
        "A treatment whose units have images, counts or culture events cannot be deleted",
      );
    }
    const [row] = await tx
      .delete(experimentTreatments)
      .where(atTreatment(experimentId, treatmentId))
      .returning({ position: experimentTreatments.position });
    if (!row) {
      throw new TreatmentNotFoundError(`Unknown treatment: ${treatmentId}`);
    }
    await tx
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
  executor?: Executor,
): Promise<Unit> {
  const { experiment: experimentId, unit: unitId, code, treatment } = value;
  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    await requireTreatment(experimentId, treatment, tx);
    const units = await listUnits(experimentId, tx);
    const unit = requireUnit(units, unitId);
    const clash = units.find(
      (item) => sameName(item.code, code) && item.id !== unitId,
    );
    if (clash) {
      throw new UnitNameTakenError(`The experiment already has ${code}`);
    }
    if (unit.treatment !== treatment && isLastReplicate(units, unit)) {
      throw new UnitConflictError(
        "The last replicate of a treatment cannot be moved",
      );
    }
    const [row] = await tx
      .update(experimentUnits)
      .set({ code, treatmentId: treatment })
      .where(atUnit(experimentId, unitId))
      .returning();
    if (!row) throw new UnitNotFoundError(`Unknown unit: ${unitId}`);
    return toUnit(row);
  });
}

/** Moves several units to one treatment in one transaction; each keeps its code. */
export async function moveUnits(
  value: UnitsTreatmentUpdate,
  executor?: Executor,
): Promise<Unit[]> {
  return inTransaction(executor, async (tx) => {
    const moved: Unit[] = [];
    for (const unitId of value.units) {
      const units = await listUnits(value.experiment, tx);
      const unit = requireUnit(units, unitId);
      moved.push(
        await updateUnit(
          {
            experiment: value.experiment,
            unit: unitId,
            code: unit.code,
            treatment: value.treatment,
          },
          tx,
        ),
      );
    }
    return moved;
  });
}

/** A recorded unit stays, and so does the last replicate of its treatment. */
export async function deleteUnit(
  value: UnitRef,
  executor?: Executor,
): Promise<void> {
  const { experiment: experimentId, unit: unitId } = value;
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const units = await listUnits(experimentId, tx);
    const unit = requireUnit(units, unitId);
    if (isLastReplicate(units, unit)) {
      throw new UnitConflictError(
        "The last replicate of a treatment cannot be deleted",
      );
    }
    if (await hasRecords(experimentId, { unit: unitId }, tx)) {
      throw new UnitConflictError(
        "A unit with images, counts or culture events cannot be deleted",
      );
    }
    await tx.delete(experimentUnits).where(atUnit(experimentId, unitId));
  });
}

function requireUnit(units: readonly Unit[], unitId: string): Unit {
  const unit = units.find((item) => item.id === unitId);
  if (!unit) throw new UnitNotFoundError(`Unknown unit: ${unitId}`);
  return unit;
}

function isLastReplicate(units: readonly Unit[], unit: Unit): boolean {
  return !units.some(
    (item) => item.treatment === unit.treatment && item.id !== unit.id,
  );
}

async function requireTreatment(
  experimentId: string,
  treatmentId: string,
  tx: Executor,
): Promise<Treatment> {
  const [treatment] = await tx
    .select()
    .from(experimentTreatments)
    .where(atTreatment(experimentId, treatmentId));
  if (!treatment) {
    throw new TreatmentNotFoundError(`Unknown treatment: ${treatmentId}`);
  }
  return toTreatment(treatment);
}
