import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { resolveCountedClasses } from "../../domain/experiments/cell-reading";
import {
  ObservationConflictError,
  ObservationModelCountsConflictError,
} from "../../domain/experiments/errors";
import type {
  Experiment,
  ExperimentObservation,
  ObservationRef,
  ObservationRequest,
  ObservationUpdate,
} from "../../domain/experiments/schema";
import {
  type Executor,
  inTransaction,
  operationTime,
  single,
} from "../infra/db/client";
import {
  experimentManualReadings,
  experimentObservations,
  experimentUnits,
} from "../infra/db/schema";
import { requireModel } from "../models/public";
import { assertRecordsEndOffBench } from "./culture-events";
import {
  atObservation,
  benchExits,
  hasRecords,
  listObservations,
  listUnits,
  lockExperiment,
  requireObservation,
} from "./records";

function rejectBeforeInoculation(
  experiment: Experiment,
  observedOn: string,
): void {
  if (observedOn < experiment.inoculatedOn) {
    throw new ObservationConflictError(
      `An observation cannot precede inoculation on ${experiment.inoculatedOn}`,
    );
  }
}

async function rejectSameDay(
  experimentId: string,
  observedOn: string,
  exceptObservationId: string | null,
  db: Executor,
): Promise<void> {
  const rows = await db
    .select({ id: experimentObservations.id })
    .from(experimentObservations)
    .where(
      and(
        eq(experimentObservations.experimentId, experimentId),
        eq(experimentObservations.observedOn, observedOn),
      ),
    );
  if (rows.some((row) => row.id !== exceptObservationId)) {
    throw new ObservationConflictError(
      `The experiment already has an observation on ${observedOn}`,
    );
  }
}

export async function createObservation(
  value: ObservationRequest,
  db?: Executor,
): Promise<ExperimentObservation> {
  const {
    experiment: experimentId,
    observedOn,
    note,
    modelId,
    countedClasses,
  } = value;
  return inTransaction(db, async (db) => {
    const experiment = await lockExperiment(experimentId, db);
    rejectBeforeInoculation(experiment, observedOn);
    await rejectSameDay(experimentId, observedOn, null, db);
    const model = await requireModel(modelId, db);
    const row = single(
      await db
        .insert(experimentObservations)
        .values({
          experimentId,
          id: randomUUID(),
          inoculatedOn: experiment.inoculatedOn,
          observedOn,
          note,
          modelId,
          countedClasses: resolveCountedClasses(model, countedClasses),
          createdAt: await operationTime(db),
        })
        .returning(),
      "experimentObservations",
    );
    return requireObservation(await listObservations(experimentId, db), row.id);
  });
}

export async function updateObservation(
  value: ObservationUpdate,
  db?: Executor,
): Promise<ExperimentObservation> {
  const {
    experiment: experimentId,
    observation: observationId,
    observedOn,
    note,
    modelId,
    countedClasses,
  } = value;
  return inTransaction(db, async (db) => {
    const experiment = await lockExperiment(experimentId, db);
    const previous = requireObservation(
      await listObservations(experimentId, db),
      observationId,
    );
    if (
      previous.modelId !== modelId &&
      (await hasRecords(
        experimentId,
        { units: "all", observation: observationId },
        db,
        [experimentManualReadings],
      ))
    ) {
      throw new ObservationModelCountsConflictError(
        "Withdraw the observation's manual counts before changing its model",
      );
    }
    rejectBeforeInoculation(experiment, observedOn);
    await rejectSameDay(experimentId, observedOn, observationId, db);
    const model = await requireModel(modelId, db);
    const row = single(
      await db
        .update(experimentObservations)
        .set({
          observedOn,
          note,
          modelId,
          countedClasses: resolveCountedClasses(model, countedClasses),
        })
        .where(atObservation(experimentId, observationId))
        .returning(),
      "experimentObservations",
    );
    const observations = await listObservations(experimentId, db);
    if (previous.observedOn !== observedOn) {
      const exits = benchExits(experimentId, db);
      const left = await db.select({ unit: exits.unit }).from(exits);
      await assertRecordsEndOffBench(
        experimentId,
        await listUnits(experimentId, db, {
          units: left.map((row) => row.unit),
        }),
        observations,
        db,
      );
    }
    return requireObservation(observations, row.id);
  });
}

export async function deleteObservation(
  value: ObservationRef,
  db?: Executor,
): Promise<void> {
  const { experiment: experimentId, observation: observationId } = value;
  await inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    const observation = requireObservation(
      await listObservations(experimentId, db),
      observationId,
    );
    if (observation.hasRecords) {
      throw new ObservationConflictError(
        "An observation with images, counts or culture events cannot be deleted",
      );
    }
    // A unit that took its rates against the observation takes them
    // against the first again.
    await db
      .update(experimentUnits)
      .set({ baselineObservationId: null })
      .where(
        and(
          eq(experimentUnits.experimentId, experimentId),
          eq(experimentUnits.baselineObservationId, observationId),
        ),
      );
    await db
      .delete(experimentObservations)
      .where(atObservation(experimentId, observationId));
  });
}
